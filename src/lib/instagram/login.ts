import 'server-only'

import { getPlatformCredentials } from '@/lib/platform-credentials'
import { MetaOnboardingError } from '@/lib/meta/onboarding'

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
     * O id da conta vem **aqui**, na troca do código, e em nenhum outro lugar
     * óbvio depois. Perdê-lo obriga a uma consulta a mais para descobrir de
     * quem é o token que acabamos de receber.
     */
    const igAccountId = curto.user_id

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
        igAccountId: String(igAccountId ?? ''),
    }
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
export async function assinarConta(igAccountId: string, token: string): Promise<void> {
    const url = new URL(`${GRAPH_IG}/${igAccountId}/subscribed_apps`)
    url.searchParams.set(
        'subscribed_fields',
        ['messages', 'messaging_seen', 'message_reactions', 'messaging_postbacks'].join(',')
    )

    await chamar('assinatura da conta', url.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    })
}

/** Quem é a conta: o @ que a clínica reconhece. */
export async function perfilDaConta(
    igAccountId: string,
    token: string
): Promise<{ username?: string; name?: string }> {
    const corpo = await chamar(
        'perfil da conta',
        `${GRAPH_IG}/${igAccountId}?fields=user_id,username,name`,
        { headers: { Authorization: `Bearer ${token}` } }
    )
    return {
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
