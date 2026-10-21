import 'server-only'

import { getPlatformCredentials } from '@/lib/platform-credentials'
import { GRAPH } from '@/lib/meta/graph'
import { META_PROVIDER } from '@/lib/meta/webhook'

/**
 * A sequência que transforma o clique da clínica numa linha funcionando.
 *
 * O Embedded Signup devolve ao navegador um **código de trinta segundos** e os
 * ids que a clínica escolheu. Daí para frente é tudo servidor, e nesta ordem,
 * porque cada passo depende do anterior:
 *
 * 1. trocar o código pelo token da conta dela;
 * 2. assinar o nosso app à conta dela, senão a Meta não nos manda evento —
 *    foi exatamente o que faltou no número de teste e deu "instance not found";
 * 3. registrar o número no Cloud API, que é o que o habilita a enviar.
 *
 * **Trinta segundos é pouco de propósito**: o código não pode passear por fila
 * nem esperar interação. Por isso a troca é a primeira coisa que a rota faz.
 */


export class MetaOnboardingError extends Error {
    constructor(
        readonly passo: string,
        readonly detalhe: string,
        /**
         * O `error.code` da Meta, quando ela manda um.
         *
         * Existe por causa do **190**, que é "token inválido ou expirado" e é o
         * único erro desta integração que tem conserto do lado da clínica:
         * reconectar. Sem o código, quem chama só tem a frase em inglês da
         * Meta para decidir — e decidir por `includes('expired')` quebra na
         * primeira vez que eles reescrevem a mensagem.
         */
        readonly codigo?: number
    ) {
        super(`${passo}: ${detalhe}`)
        this.name = 'MetaOnboardingError'
    }
}

/**
 * O token morreu — expirou, foi revogado, ou a clínica tirou o acesso.
 *
 * Code 190 cobre os três, e os três têm a mesma saída: reconectar pela Meta.
 */
export function tokenMorreu(erro: unknown): boolean {
    return erro instanceof MetaOnboardingError && erro.codigo === 190
}

async function graph(
    passo: string,
    url: string,
    init?: RequestInit
): Promise<Record<string, unknown>> {
    const resposta = await fetch(url, init)
    const texto = await resposta.text()

    let corpo: Record<string, unknown> = {}
    try {
        corpo = JSON.parse(texto) as Record<string, unknown>
    } catch {
        // A Meta responde JSON até nos erros; corpo que não é JSON é proxy ou
        // bloqueio no caminho, e vale dizer isso em vez de "erro desconhecido".
        throw new MetaOnboardingError(passo, `resposta não-JSON: ${texto.slice(0, 200)}`)
    }

    if (!resposta.ok) {
        const erro = (corpo.error ?? {}) as { message?: string; code?: number }
        throw new MetaOnboardingError(
            passo,
            erro.message ?? `HTTP ${resposta.status}: ${texto.slice(0, 200)}`,
            erro.code
        )
    }

    return corpo
}

/**
 * Troca o código do navegador pelo token da conta da clínica.
 *
 * O token que volta é do **usuário de sistema de integração de negócio** dela —
 * não expira como o temporário de 24 horas do painel, e é com ele que tudo o
 * mais é feito em nome dela.
 */
export interface TokenDaConta {
    token: string
    /**
     * Quando ele morre, em ISO — `null` quando não morre.
     *
     * Guardado junto da integração para que a tela possa avisar **antes**, em
     * vez de a clínica descobrir pela mensagem que não chegou.
     */
    expiraEm: string | null
}

/**
 * O que a Meta sabe sobre um token: de quem é, e até quando vale.
 *
 * `expires_at: 0` é a resposta para token que não expira — o do usuário de
 * sistema de integração de negócio, que é o que o Embedded Signup deveria
 * devolver. Qualquer outro número é prazo.
 *
 * A inspeção usa o **token do aplicativo** (`id|segredo`), não o que está sendo
 * inspecionado: um token morto não consegue nem falar sobre si mesmo.
 */
async function prazoDoToken(token: string, app: { clientId: string; clientSecret: string }) {
    const url = new URL(`${GRAPH}/debug_token`)
    url.searchParams.set('input_token', token)
    url.searchParams.set('access_token', `${app.clientId}|${app.clientSecret}`)

    const corpo = await graph('inspeção do token', url.toString())
    const dados = (corpo.data ?? {}) as { expires_at?: number; type?: string }

    return {
        /** Segundos desde a época; 0 ou ausente é "não expira". */
        expiraEm: dados.expires_at && dados.expires_at > 0 ? dados.expires_at : null,
        tipo: dados.type ?? null,
    }
}

export async function trocarCodigoPorToken(code: string): Promise<TokenDaConta> {
    const app = await getPlatformCredentials(META_PROVIDER)
    if (!app) {
        throw new MetaOnboardingError(
            'credenciais',
            'o aplicativo da Meta não está registrado em Aplicativos da plataforma'
        )
    }

    const url = new URL(`${GRAPH}/oauth/access_token`)
    url.searchParams.set('client_id', app.clientId)
    url.searchParams.set('client_secret', app.clientSecret)
    url.searchParams.set('code', code)

    const corpo = await graph('troca do código', url.toString())

    if (typeof corpo.access_token !== 'string' || !corpo.access_token) {
        throw new MetaOnboardingError('troca do código', 'a Meta não devolveu token')
    }

    let token: string = corpo.access_token

    /**
     * **O token nem sempre é o que este arquivo dizia que era.**
     *
     * O comentário aqui afirmava que o Embedded Signup devolve o token do
     * usuário de sistema, que não expira. Em 2026-10-20 o Andre ligou a chave
     * do canal oficial e a Meta respondeu "Session has expired on Friday,
     * 16-Oct-26 15:00:00" — o mesmo dia da conexão. Ou seja: veio um token de
     * usuário, de poucas horas, e a conexão estava morta desde então sem que
     * nada na tela dissesse isso.
     *
     * Pode ter sido o aplicativo ainda em desenvolvimento, à espera da revisão
     * da Meta; pode ser o fluxo. **Não dá para saber sem outra conexão real**,
     * e por isso aqui não se aposta: pergunta-se. Se o token tem prazo, ele é
     * trocado pelo de longa duração (~60 dias); se não tem, a troca é pulada,
     * porque trocar um token de sistema por outro não faz sentido e a Meta
     * recusa.
     *
     * O prazo é devolvido junto para ser gravado — é o que permite avisar
     * antes, em vez de a clínica descobrir pela mensagem que não chegou.
     */
    /**
     * **A inspeção não pode derrubar a conexão.**
     *
     * Ela é diagnóstico, não requisito: se `debug_token` recusar — aplicativo
     * sem permissão, Graph fora do ar —, o token que acabou de ser emitido
     * continua válido e a clínica continua conectando. Deixar o `throw` subir
     * aqui trocaria um canal que morre em horas por um canal que nunca nasce,
     * que é um defeito pior do que o que esta inspeção veio resolver.
     */
    let prazo: { expiraEm: number | null; tipo: string | null }
    try {
        prazo = await prazoDoToken(token, app)
    } catch (erro) {
        console.warn('[META_ONBOARDING] não foi possível inspecionar o token', erro)
        prazo = { expiraEm: null, tipo: null }
    }

    if (prazo.expiraEm) {
        const troca = new URL(`${GRAPH}/oauth/access_token`)
        troca.searchParams.set('grant_type', 'fb_exchange_token')
        troca.searchParams.set('client_id', app.clientId)
        troca.searchParams.set('client_secret', app.clientSecret)
        troca.searchParams.set('fb_exchange_token', token)

        try {
            const longo = await graph('token de longa duração', troca.toString())
            if (typeof longo.access_token === 'string' && longo.access_token) {
                token = longo.access_token
                prazo = await prazoDoToken(token, app)
            }
        } catch (erro) {
            // Falhar aqui não derruba a conexão: o token curto funciona hoje, e
            // recusar agora deixaria a clínica sem canal nenhum. O prazo gravado
            // é o do curto, e é ele que vai disparar o aviso.
            console.warn('[META_ONBOARDING] não foi possível alongar o token', erro)
        }
    }

    return {
        token,
        expiraEm: prazo.expiraEm ? new Date(prazo.expiraEm * 1000).toISOString() : null,
    }
}

/**
 * Assina o nosso aplicativo à conta da clínica.
 *
 * Sem isto a Meta valida o webhook, responde tudo com sucesso, e **não manda
 * evento nenhum** — o log do Evolution v2 diz só "instance not found", que não
 * aponta para cá. Medido em 2026-10-16 no número de teste: foi preciso fazer
 * esta chamada à mão para a primeira mensagem real chegar.
 */
export async function assinarContaAoApp(wabaId: string, token: string): Promise<void> {
    await graph('assinatura da conta', `${GRAPH}/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    })
}

/**
 * Desfaz a assinatura — é o que "desligar" significa neste canal.
 *
 * Sem a assinatura a Meta para de nos mandar evento, e é só isso que para: o
 * número continua registrado no Cloud API, o token continua válido e a conta
 * continua sendo da clínica. Desfazer o registro seria caro de refazer (PIN,
 * verificação, e o risco de a coexistência com o aplicativo quebrar), e o
 * Andre decidiu em 2026-10-20 que desligar não chega a tanto.
 *
 * É a mesma simetria do Instagram, onde `deleteInstance` também só desassina.
 */
export async function desassinarContaDoApp(wabaId: string, token: string): Promise<void> {
    await graph('fim da assinatura da conta', `${GRAPH}/${wabaId}/subscribed_apps`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    })
}

/**
 * Registra o número no Cloud API.
 *
 * **Tolera "já registrado"**, que é o caso da clínica vinda por coexistência —
 * aquela que já usava o aplicativo WhatsApp Business naquele número, e é o caso
 * comum em consultório. Ali o número já está registrado e insistir seria erro
 * onde não há problema.
 *
 * O PIN é a verificação em duas etapas do número. Guardamos o que foi usado
 * junto da integração: sem ele, um registro futuro no mesmo número falha e
 * ninguém sabe por quê.
 */
export async function registrarNumero(
    phoneNumberId: string,
    token: string,
    pin: string
): Promise<{ registrado: boolean; jaEstava: boolean }> {
    try {
        await graph('registro do número', `${GRAPH}/${phoneNumberId}/register`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
        })
        return { registrado: true, jaEstava: false }
    } catch (error) {
        const detalhe = error instanceof MetaOnboardingError ? error.detalhe : String(error)
        if (/already.*registered|já.*registrad/i.test(detalhe)) {
            return { registrado: true, jaEstava: true }
        }
        throw error
    }
}

/** Um PIN de seis dígitos, aleatório. É a verificação em duas etapas do número. */
export function novoPin(): string {
    return String(Math.floor(100000 + Math.random() * 900000))
}
