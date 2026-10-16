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
        readonly detalhe: string
    ) {
        super(`${passo}: ${detalhe}`)
        this.name = 'MetaOnboardingError'
    }
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
            erro.message ?? `HTTP ${resposta.status}: ${texto.slice(0, 200)}`
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
export async function trocarCodigoPorToken(code: string): Promise<string> {
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
    const token = corpo.access_token

    if (typeof token !== 'string' || !token) {
        throw new MetaOnboardingError('troca do código', 'a Meta não devolveu token')
    }

    return token
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
