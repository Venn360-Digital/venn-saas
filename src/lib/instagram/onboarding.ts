import 'server-only'

import { GRAPH } from '@/lib/meta/graph'
import { MetaOnboardingError } from '@/lib/meta/onboarding'
import { getPlatformCredentials } from '@/lib/platform-credentials'
import { META_PROVIDER } from '@/lib/meta/webhook'

/**
 * Ligar o Instagram de uma clínica, do clique dela até o Direct funcionando.
 *
 * **A rota importa mais que o código.** A Meta oferece dois caminhos para a API
 * de mensagens do Instagram, e eles custam coisas muito diferentes:
 *
 * - *Instagram Login* (`graph.instagram.com`, sem Página do Facebook): devolve
 *   token de **60 dias**, que precisa ser renovado antes de vencer. Se vencer,
 *   **não há recuperação** — a clínica refaz o consentimento inteiro, a Meta não
 *   avisa ninguém, e nós só descobrimos pelo erro 190 na próxima tentativa de
 *   envio. É o defeito que a comunidade do Chatwoot reporta até hoje.
 * - *Facebook Login* (`graph.facebook.com`, conta ligada a uma Página): o token
 *   da Página, derivado de um token de usuário de longa duração, **não expira**.
 *
 * Usamos a segunda, que é também a que o WhatsApp oficial já usa. O custo é
 * exigir que a conta profissional esteja ligada a uma Página do Facebook — e o
 * que se ganha é não ter esteira de renovação nenhuma, nem o risco de a conta
 * cair em silêncio num domingo três meses depois.
 *
 * A sequência, e por que nesta ordem:
 *
 * 1. **trocar o código** que o navegador trouxe pelo token do usuário — vale
 *    poucos segundos, então vem antes de qualquer ida ao banco;
 * 2. **esticar o token** para longa duração, que é o que faz o token da Página
 *    nascer sem prazo;
 * 3. **achar a Página e a conta**, que é onde se descobre que a clínica nunca
 *    ligou as duas — o erro mais comum, e o que precisa de mensagem em
 *    português, não de um `(#100)` da Meta;
 * 4. **assinar a Página ao aplicativo**, sem o que a Meta aceita tudo e não
 *    manda evento nenhum. Foi exatamente o que faltou no WhatsApp em
 *    2026-10-16 e custou uma tarde.
 */

/**
 * Os eventos que pedimos à Meta.
 *
 * `messages` é o canal; `messaging_seen` dá o "visto" na caixa de entrada;
 * `message_reactions` traz o coraçãozinho, que é metade da conversa no Direct;
 * `messaging_postbacks` traz os botões de início de conversa.
 *
 * Fora da lista de propósito: `message_echoes` duplicaria toda resposta nossa,
 * e `comments`/`mentions` são do produto de conteúdo, não do atendimento.
 */
const CAMPOS_ASSINADOS = [
    'messages',
    'messaging_seen',
    'message_reactions',
    'messaging_postbacks',
] as const

export interface ContaDeInstagram {
    /** A conta profissional do Instagram. */
    igAccountId: string
    /** O @ dela, que é como a clínica a reconhece. */
    username?: string
    /** A Página a que ela está ligada. */
    pageId: string
    pageName: string
    /** Token da Página. Não sai daqui para o navegador. */
    accessToken: string
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
        throw new MetaOnboardingError(passo, `resposta não-JSON: ${texto.slice(0, 200)}`)
    }

    if (!resposta.ok) {
        const erro = (corpo.error ?? {}) as { message?: string }
        throw new MetaOnboardingError(
            passo,
            erro.message ?? `HTTP ${resposta.status}: ${texto.slice(0, 200)}`
        )
    }

    return corpo
}

async function credenciaisDoApp(): Promise<{ clientId: string; clientSecret: string }> {
    const app = await getPlatformCredentials(META_PROVIDER)
    if (!app) {
        throw new MetaOnboardingError(
            'credenciais',
            'o aplicativo da Meta não está registrado em Aplicativos da plataforma'
        )
    }
    return app
}

/** Troca o código que o navegador trouxe pelo token do usuário. */
export async function trocarCodigoPorTokenDeUsuario(code: string): Promise<string> {
    const app = await credenciaisDoApp()

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
 * Estica o token do usuário para longa duração.
 *
 * É o passo que faz o token da Página nascer **sem prazo**: a Meta só dispensa a
 * validade do token de Página quando ele é derivado de um token de usuário de
 * longa duração. Derivar de um token curto dá um token de Página curto, e aí a
 * conta da clínica para de funcionar em algumas horas — sem aviso.
 *
 * Tolera falha de propósito: pela configuração de *Login do Facebook para
 * Empresas* o token que chega já é de usuário de sistema e já não expira, e a
 * troca então é recusada. Nesse caso o token original é o certo, e insistir
 * seria trocar uma coisa boa por um erro.
 */
export async function tokenDeLongaDuracao(tokenCurto: string): Promise<string> {
    const app = await credenciaisDoApp()

    const url = new URL(`${GRAPH}/oauth/access_token`)
    url.searchParams.set('grant_type', 'fb_exchange_token')
    url.searchParams.set('client_id', app.clientId)
    url.searchParams.set('client_secret', app.clientSecret)
    url.searchParams.set('fb_exchange_token', tokenCurto)

    try {
        const corpo = await graph('token de longa duração', url.toString())
        const token = corpo.access_token
        return typeof token === 'string' && token ? token : tokenCurto
    } catch {
        return tokenCurto
    }
}

interface PaginaDaMeta {
    id?: string
    name?: string
    access_token?: string
    instagram_business_account?: { id?: string; username?: string }
}

/**
 * As contas de Instagram que esta pessoa pode ligar.
 *
 * Uma clínica normalmente tem uma; uma rede pode ter várias, e aí é ela que
 * escolhe — adivinhar pela primeira da lista ligaria a unidade errada, e isso só
 * apareceria quando um paciente escrevesse para a outra.
 *
 * Página sem Instagram ligado é descartada aqui, não oferecida e recusada
 * depois: oferecer o que não serve é pedir para o usuário errar.
 */
export async function contasDisponiveis(tokenDeUsuario: string): Promise<ContaDeInstagram[]> {
    const url = new URL(`${GRAPH}/me/accounts`)
    url.searchParams.set(
        'fields',
        'id,name,access_token,instagram_business_account{id,username}'
    )
    url.searchParams.set('limit', '100')

    const corpo = await graph('páginas da clínica', url.toString(), {
        headers: { Authorization: `Bearer ${tokenDeUsuario}` },
    })

    const paginas = Array.isArray(corpo.data) ? (corpo.data as PaginaDaMeta[]) : []

    return paginas.flatMap((pagina) => {
        const ig = pagina.instagram_business_account
        if (!ig?.id || !pagina.id) return []

        /**
         * Nem toda configuração devolve um token por Página — e isso é uma
         * escolha no painel da Meta, não um defeito.
         *
         * Com *token de acesso do usuário*, `/me/accounts` devolve o token de
         * cada Página, e é ele que usamos: derivado de um token de usuário de
         * longa duração, **não tem data de validade**.
         *
         * Com *token de usuário do sistema*, o token que já está em mãos vale
         * pelas Páginas concedidas — a Meta documenta que esse token suporta
         * `pages_messaging` e `instagram_manage_messages` e, por padrão, não
         * expira. Ali o campo `access_token` por Página pode simplesmente não
         * vir.
         *
         * Exigir o token da Página, como a primeira versão fazia, descartaria
         * silenciosamente toda conta nesse segundo caso — e a clínica leria
         * "nenhuma conta ligada a uma Página" tendo acabado de escolher a conta
         * dela na janela da Meta. O erro mandaria procurar defeito onde não há.
         */
        return [
            {
                igAccountId: ig.id,
                username: ig.username,
                pageId: pagina.id,
                pageName: pagina.name ?? 'Página sem nome',
                accessToken: pagina.access_token ?? tokenDeUsuario,
            },
        ]
    })
}

/**
 * Assina a Página ao nosso aplicativo.
 *
 * **Sem isto não chega evento nenhum**, e o pior é que nada falha: a Meta
 * valida o webhook, responde sucesso em tudo, e o Direct simplesmente nunca
 * aparece na caixa de entrada. Foi assim no WhatsApp, onde o único sintoma
 * ficou num log do Evolution que não apontava para a causa.
 */
export async function assinarPaginaAoApp(
    pageId: string,
    tokenDaPagina: string
): Promise<void> {
    const url = new URL(`${GRAPH}/${pageId}/subscribed_apps`)
    url.searchParams.set('subscribed_fields', CAMPOS_ASSINADOS.join(','))

    await graph('assinatura da página', url.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenDaPagina}` },
    })
}

/**
 * As permissões sem as quais este fluxo não funciona, e o que cada uma faz.
 *
 * A lista é curta de propósito. Pedir permissão que não se usa é o que trava
 * revisão de aplicativo e o que faz a clínica desistir na janela de
 * consentimento — e a própria Meta, no guia de início do Instagram Messaging,
 * cita só as três primeiras. `pages_show_list` entra porque **nós** listamos as
 * Páginas da clínica para descobrir qual tem Instagram ligado.
 *
 * Fora da lista de propósito: `pages_messaging` é do Messenger, que não está no
 * escopo; `pages_read_engagement` serve para ler conteúdo da Página, e não
 * lemos nenhum.
 */
export const PERMISSOES_NECESSARIAS: Record<string, string> = {
    instagram_basic: 'descobrir qual conta de Instagram está ligada à Página',
    instagram_manage_messages: 'receber e responder o Direct',
    pages_manage_metadata: 'assinar a Página ao aplicativo, que é o que faz o evento chegar',
    pages_show_list: 'listar as Páginas da clínica para achar a certa',
}

/**
 * Quais das permissões necessárias **não** foram concedidas.
 *
 * Só é chamada no caminho da falha, e existe para desfazer uma ambiguidade
 * cara: `/me/accounts` devolve lista vazia tanto quando a conta não está ligada
 * a uma Página quanto quando falta permissão para enxergá-la. São problemas
 * opostos — um é da clínica, outro é da configuração no painel da Meta — e
 * mandar a pessoa errada procurar o defeito custa uma tarde.
 */
async function permissoesFaltando(tokenDeUsuario: string): Promise<string[]> {
    try {
        const corpo = await graph('permissões', `${GRAPH}/me/permissions`, {
            headers: { Authorization: `Bearer ${tokenDeUsuario}` },
        })
        const lista = Array.isArray(corpo.data)
            ? (corpo.data as { permission?: string; status?: string }[])
            : []

        const concedidas = new Set(
            lista.filter((p) => p.status === 'granted').map((p) => p.permission)
        )
        return Object.keys(PERMISSOES_NECESSARIAS).filter((p) => !concedidas.has(p))
    } catch {
        // A consulta é diagnóstico: falhar aqui não pode trocar a mensagem da
        // clínica por um erro sobre a consulta em si.
        return []
    }
}

/**
 * Por que não há conta para ligar — dizendo qual dos dois motivos é o seu.
 *
 * A lista vazia da Meta vem sem erro e sem pista. Esta função transforma o
 * silêncio dela em uma das duas frases que levam a pessoa certa ao lugar certo.
 */
export async function explicarListaVazia(tokenDeUsuario: string): Promise<string> {
    const faltando = await permissoesFaltando(tokenDeUsuario)

    if (faltando.length > 0) {
        const detalhe = faltando
            .map((p) => `${p} (${PERMISSOES_NECESSARIAS[p]})`)
            .join('; ')
        return (
            'A conexão foi autorizada, mas sem as permissões necessárias: ' +
            `${detalhe}. Isto é configuração do aplicativo na Meta, não da clínica — ` +
            'acrescente-as à configuração do Login do Facebook para Empresas e tente de novo.'
        )
    }

    return SEM_CONTA_LIGADA
}

/**
 * A mensagem que a clínica lê quando não há conta para ligar.
 *
 * Separada porque é a falha mais comum deste fluxo e a que a Meta explica pior:
 * ela devolve uma lista vazia, sem erro, e um "nenhuma conta encontrada" manda a
 * clínica procurar defeito onde não há.
 */
export const SEM_CONTA_LIGADA =
    'Não encontramos uma conta profissional do Instagram ligada a uma Página do Facebook ' +
    'nesta conta. No aplicativo do Instagram, em Configurações → Conta, mude para conta ' +
    'profissional e ligue-a a uma Página; depois tente conectar de novo.'

/**
 * O aviso do botão invisível, que não dá erro nenhum e quebra tudo.
 *
 * A clínica precisa ligar, **no aplicativo do Instagram**, em Configurações →
 * Mensagens e respostas de story → Controles de mensagens → Ferramentas
 * conectadas → *Permitir acesso a mensagens*. Conceder a permissão no OAuth
 * **não** liga essa chave, ela não aparece em painel nenhum de desenvolvedor, e
 * com ela desligada a conexão fica verde e os envios falham calados.
 *
 * É o equivalente, no Instagram, da assinatura da conta que nos custou uma
 * tarde no WhatsApp — e por isso está na tela, não só neste comentário.
 */
export const PERMITIR_ACESSO_A_MENSAGENS =
    'No aplicativo do Instagram, confirme que está ligado: Configurações → Mensagens e ' +
    'respostas de story → Controles de mensagens → Ferramentas conectadas → Permitir ' +
    'acesso a mensagens. Sem essa chave a conexão fica verde e nenhuma mensagem sai.'
