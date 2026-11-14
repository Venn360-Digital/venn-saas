import 'server-only'

import { getPlatformCredentials } from '../platform-credentials'
import { MetaOnboardingError } from '../meta/onboarding'

/**
 * Business Login for Instagram — a clínica entra com a conta dela, e mais nada.
 *
 * **Por que esta rota substituiu a do Facebook Login.** Aquela exigia três
 * coisas da clínica: conta profissional, Página do Facebook vinculada e
 * portfólio empresarial. Consultório pequeno tem Instagram, e só — o atrito não
 * estava no nosso fluxo, estava no pré-requisito, e nenhuma mensagem de erro
 * bem escrita conserta isso. Trocamos um custo do cliente (montar uma estrutura
 * de negócios na Meta) por um custo nosso (renovar um token), que é o lado
 * certo para o custo ficar.
 *
 * **O preço, dito com todas as letras.** Aqui o token dura **60 dias** e
 * precisa ser renovado antes de vencer. Vencido, não há recuperação: a clínica
 * refaz o consentimento inteiro, e a Meta não avisa ninguém — o sintoma é o
 * erro 190 na próxima tentativa de envio, dias depois. Por isso a renovação é
 * parte do canal, não um extra: ver o cron `instagram-token-refresh`.
 *
 * **E são outras credenciais.** O *Instagram App ID* e o *Instagram App Secret*
 * não são os do aplicativo do Facebook — moram na própria configuração do
 * Instagram, no painel. Usar os do Facebook aqui devolve um erro de cliente
 * inválido que não diz qual dos dois está errado.
 */

/** O provedor de plataforma desta rota, separado do `meta_messaging`. */
export const INSTAGRAM_LOGIN_PROVIDER = 'instagram_login'

/**
 * O host do Instagram tem a própria linha de versões.
 *
 * Não é a mesma de `graph.facebook.com`: os exemplos da documentação desta API
 * usam `v25.0`, e fixar a versão é o que evita uma chamada mudar de
 * comportamento sozinha num sábado.
 */
const GRAPH_IG = 'https://graph.instagram.com/v25.0'
const OAUTH_IG = 'https://api.instagram.com/oauth/access_token'
const AUTORIZAR_IG = 'https://www.instagram.com/oauth/authorize'

/**
 * O que pedimos à clínica, e nada além.
 *
 * `instagram_business_basic` identifica a conta; `..._manage_messages` é o
 * Direct. Fora da lista de propósito: `..._content_publish` publica no feed e
 * `..._manage_comments` mexe em comentários — nenhum dos dois é atendimento, e
 * pedir o que não se usa é o que faz a clínica fechar a janela.
 */
export const ESCOPOS = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
] as const

export interface TokenDeInstagram {
    accessToken: string
    /** Quando ele vence. É o que o cron de renovação lê. */
    expiraEm: Date
    /** A conta profissional a que o token pertence. */
    igAccountId: string
    /**
     * O que a Meta **de fato** concedeu, quando ela diz.
     *
     * Nem sempre vem. Vazio significa "não deu para saber", e não "nada foi
     * concedido" — confundir os dois recusaria conexões boas.
     */
    permissoes: string[]
}

async function credenciais(): Promise<{ clientId: string; clientSecret: string }> {
    const app = await getPlatformCredentials(INSTAGRAM_LOGIN_PROVIDER)
    if (!app) {
        throw new MetaOnboardingError(
            'credenciais',
            'o Instagram App ID e o App Secret não estão registrados em Aplicativos da plataforma'
        )
    }
    return app
}

async function chamar(
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
        /**
         * Esta API relata erro de dois jeitos diferentes.
         *
         * O host `graph.instagram.com` usa `{error:{message}}`, como a Graph do
         * Facebook; o `api.instagram.com` da troca do código usa
         * `{error_message}` na raiz. Ler só um deixa o outro virar
         * "erro desconhecido" bem no passo mais provável de falhar.
         */
        const aninhado = (corpo.error ?? {}) as { message?: string }
        const detalhe =
            aninhado.message ??
            (typeof corpo.error_message === 'string' ? corpo.error_message : null) ??
            `HTTP ${resposta.status}: ${texto.slice(0, 200)}`
        throw new MetaOnboardingError(passo, detalhe)
    }

    return corpo
}

/** O endereço do consentimento, para onde a clínica é levada. */
export async function urlDeAutorizacao(input: {
    redirectUri: string
    state: string
}): Promise<string> {
    const app = await credenciais()

    const url = new URL(AUTORIZAR_IG)
    url.searchParams.set('client_id', app.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', ESCOPOS.join(','))
    url.searchParams.set('state', input.state)

    return url.toString()
}

/**
 * Do código ao token de 60 dias, que é o único que serve.
 *
 * São **duas** trocas e não uma: a primeira devolve um token de uma hora, e é
 * fácil pará-la aí e guardar algo que morre antes do fim do dia. A segunda é a
 * que dá os 60 dias.
 */
export async function trocarCodigoPorToken(
    code: string,
    redirectUri: string
): Promise<TokenDeInstagram> {
    const app = await credenciais()

    const curto = await chamar('troca do código', OAUTH_IG, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: app.clientId,
            client_secret: app.clientSecret,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code,
        }),
    })

    const tokenCurto = curto.access_token

    /**
     * O `user_id` daqui **não** é o id da conta profissional.
     *
     * Ele é escopado ao aplicativo — outro número, parecido o bastante para
     * enganar. Usá-lo para assinar devolve "Object with ID '…' does not exist,
     * cannot be loaded due to missing permissions, or does not support this
     * operation", que descreve três causas e não diz qual é. O id de verdade
     * vem de `/me?fields=user_id`, e é também o que aparece no `entry[].id` de
     * cada evento do webhook — ou seja, é por ele que o evento acha o
     * workspace. Guardar o errado quebraria as duas pontas.
     *
     * Fica aqui só como reserva, para o caso de `/me` não responder.
     */
    const idEscopadoAoApp = curto.user_id

    /**
     * O que foi concedido, quando a Meta conta.
     *
     * Existe por um silêncio de três horas: a permissão de mensagens não
     * estava marcada no caso de uso, o Instagram mostrou o consentimento, a
     * clínica aprovou, e ele concedeu **só o que existia** — sem erro em lugar
     * nenhum. A linha ficou verde, `/me` respondia, e a caixa de mensagens
     * simplesmente não existia para o aplicativo.
     */
    const permissoes = Array.isArray(curto.permissions)
        ? (curto.permissions as unknown[]).map(String)
        : []

    if (typeof tokenCurto !== 'string' || !tokenCurto) {
        throw new MetaOnboardingError('troca do código', 'a Meta não devolveu token')
    }

    const longo = await chamar(
        'token de 60 dias',
        `${GRAPH_IG}/access_token?grant_type=ig_exchange_token` +
            `&client_secret=${encodeURIComponent(app.clientSecret)}` +
            `&access_token=${encodeURIComponent(tokenCurto)}`
    )

    const accessToken = longo.access_token
    if (typeof accessToken !== 'string' || !accessToken) {
        throw new MetaOnboardingError('token de 60 dias', 'a Meta não devolveu o token longo')
    }

    return {
        accessToken,
        expiraEm: vencimento(longo.expires_in),
        igAccountId: String(idEscopadoAoApp ?? ''),
        permissoes,
    }
}

/** A permissão sem a qual o canal existe no papel e não atende. */
export const PERMISSAO_DE_MENSAGENS = 'instagram_business_manage_messages'

/**
 * Se a Meta disse o que concedeu, e a de mensagens não está lá.
 *
 * **Lista vazia não acusa**: ela quer dizer "a Meta não contou", e recusar aí
 * derrubaria conexões boas por falta de informação. Só acusa quando há lista e
 * a permissão não está nela — que é o caso real e silencioso.
 */
export function faltaPermissaoDeMensagens(permissoes: string[]): boolean {
    return permissoes.length > 0 && !permissoes.includes(PERMISSAO_DE_MENSAGENS)
}

/**
 * Renova o token antes que ele vença.
 *
 * A Meta exige que o token tenha **pelo menos 24 horas de vida** e ainda esteja
 * válido; renovar devolve 60 dias contados da renovação, não do início. Um
 * token vencido não se renova — e é por isso que o cron trabalha com folga
 * larga em vez de esperar o último dia.
 */
export async function renovarToken(token: string): Promise<{ accessToken: string; expiraEm: Date }> {
    const corpo = await chamar(
        'renovação do token',
        `${GRAPH_IG}/refresh_access_token?grant_type=ig_refresh_token` +
            `&access_token=${encodeURIComponent(token)}`
    )

    const accessToken = corpo.access_token
    if (typeof accessToken !== 'string' || !accessToken) {
        throw new MetaOnboardingError('renovação do token', 'a Meta não devolveu token novo')
    }

    return { accessToken, expiraEm: vencimento(corpo.expires_in) }
}

/**
 * Assina a conta ao aplicativo. Sem isto, nenhum evento chega.
 *
 * Aqui é a **conta**, e não há Página nenhuma no caminho — o que, nesta rota,
 * deixa de ser uma escolha e passa a ser a única possibilidade.
 */
export async function assinarConta(token: string): Promise<void> {
    /**
     * `/me` e não `/{id}`: o token já diz de quem é.
     *
     * Esta rota tem **dois** ids em circulação — o escopado ao aplicativo, que
     * volta na troca do código, e o da conta profissional. Endereçar pelo
     * errado devolve um erro que lista três causas possíveis e não diz qual.
     * `/me` não tem como errar: resolve para a conta do próprio token.
     */
    const url = new URL(`${GRAPH_IG}/me/subscribed_apps`)
    url.searchParams.set(
        'subscribed_fields',
        ['messages', 'messaging_seen', 'message_reactions', 'messaging_postbacks'].join(',')
    )

    await chamar('assinatura da conta', url.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    })
}

/**
 * Quem é a conta — o id que importa e o @ que a clínica reconhece.
 *
 * **O `user_id` daqui é o id da conta profissional**, que é outro número que o
 * `id` (escopado ao aplicativo) devolvido ao lado. É o da conta que aparece no
 * `entry[].id` de cada evento do webhook, então é ele que precisa ser gravado:
 * é por ele que a mensagem que chega encontra o workspace.
 */
export async function perfilDaConta(
    token: string
): Promise<{ igAccountId?: string; username?: string; name?: string }> {
    const corpo = await chamar('perfil da conta', `${GRAPH_IG}/me?fields=user_id,username,name`, {
        headers: { Authorization: `Bearer ${token}` },
    })

    const userId = corpo.user_id
    return {
        igAccountId:
            typeof userId === 'string' || typeof userId === 'number' ? String(userId) : undefined,
        username: typeof corpo.username === 'string' ? corpo.username : undefined,
        name: typeof corpo.name === 'string' ? corpo.name : undefined,
    }
}

/**
 * A data de vencimento, com um padrão conservador.
 *
 * `expires_in` vem em segundos. Quando não vier — e a Meta às vezes omite —,
 * assumir 60 dias seria otimista no lugar errado: o cron perderia a janela de
 * renovação. Assume-se **50**, que renova cedo demais em vez de tarde demais.
 */
function vencimento(expiresIn: unknown): Date {
    const segundos = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 50 * 24 * 3600
    return new Date(Date.now() + segundos * 1000)
}
