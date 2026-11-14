import 'server-only'

import { GRAPH } from '../meta/graph'
import { MetaOnboardingError } from '../meta/onboarding'
import { getPlatformCredentials } from '../platform-credentials'
import { META_PROVIDER } from '../meta/webhook'

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
 * Os eventos que pedimos à Meta, **no vocabulário da Página**.
 *
 * São duas listas de nomes e elas não são a mesma — foi o que me pegou. A
 * assinatura no painel é do objeto `instagram`, onde o "visto" se chama
 * `messaging_seen`. Esta chamada assina a **Página**, e lá o mesmo evento se
 * chama `message_reads`. Mandar o nome do outro vocabulário devolve um
 * `(#100)` com a lista inteira de campos válidos de Página, que é longa o
 * bastante para esconder a diferença de uma palavra.
 *
 * `messages` é o canal; `message_reads` dá o "visto" na caixa de entrada;
 * `message_reactions` traz o coraçãozinho, que é metade da conversa no Direct;
 * `messaging_postbacks` traz os botões de início de conversa.
 *
 * Fora da lista de propósito: `message_echoes` duplicaria toda resposta nossa,
 * e `feed`/`mention` são do produto de conteúdo, não do atendimento.
 */
const CAMPOS_ASSINADOS = [
    'messages',
    'message_reads',
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

/**
 * Troca o código que voltou do diálogo pelo token do usuário.
 *
 * O `redirectUri` **não é decorativo**: a Meta exige que seja idêntico ao usado
 * para abrir o diálogo, e recusa a troca com
 * *"Error validating verification code"* quando falta ou difere. Foi
 * exatamente o que derrubou a primeira versão, que tentava trocar um código
 * nascido no SDK do Facebook — onde esse endereço é escolhido pelo SDK e não
 * temos como repeti-lo. Por isso o fluxo passou a ser por redirecionamento, com
 * um endereço nosso. Ver `lib/instagram/oauth.ts`.
 */
export async function trocarCodigoPorTokenDeUsuario(
    code: string,
    redirectUri: string
): Promise<string> {
    const app = await credenciaisDoApp()

    const url = new URL(`${GRAPH}/oauth/access_token`)
    url.searchParams.set('client_id', app.clientId)
    url.searchParams.set('client_secret', app.clientSecret)
    url.searchParams.set('redirect_uri', redirectUri)
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
 * Os campos no vocabulário da **conta de Instagram**.
 *
 * Diferente do da Página: aqui o "visto" é `messaging_seen`. Ver
 * `CAMPOS_ASSINADOS` para o porquê de existirem duas listas.
 */
const CAMPOS_DA_CONTA = [
    'messages',
    'messaging_seen',
    'message_reactions',
    'messaging_postbacks',
] as const

/**
 * Assina a **conta de Instagram** ao aplicativo. É esta que entrega o Direct.
 *
 * Medido em 2026-10-17, com a conexão já feita: a Página estava assinada com os
 * quatro campos dela e **nenhum evento chegava**. `GET /{conta}/subscribed_apps`
 * devolvia lista vazia — ou seja, assinar a Página não assina a conta, apesar
 * de a documentação dizer que `/me/subscribed_apps` aceita "o id da conta
 * profissional **ou** o id da Página". Para o Direct, quem vale é a conta.
 *
 * Exige `instagram_manage_messages` no token; sem ela a Meta responde
 * `(#200) Requires instagram_manage_messages permission to manage the object`.
 */
export async function assinarContaDeInstagram(
    igAccountId: string,
    token: string
): Promise<void> {
    const url = new URL(`${GRAPH}/${igAccountId}/subscribed_apps`)
    url.searchParams.set('subscribed_fields', CAMPOS_DA_CONTA.join(','))

    await graph('assinatura da conta', url.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    })
}

/**
 * Os escopos que o token realmente carrega, segundo a própria Meta.
 *
 * Existe porque "achamos a conta" não é o mesmo que "podemos atender". Com
 * `instagram_basic` sozinha, a busca de contas funciona, a Página aceita ser
 * assinada e tudo **parece** ter dado certo — mas o canal não recebe nem envia
 * mensagem nenhuma. Foi exatamente o que aconteceu: uma conexão gravada como
 * "no ar" com um token que não podia ler um Direct.
 */
export async function escoposDoToken(token: string): Promise<string[]> {
    const app = await credenciaisDoApp()

    const url = new URL(`${GRAPH}/debug_token`)
    url.searchParams.set('input_token', token)
    url.searchParams.set('access_token', `${app.clientId}|${app.clientSecret}`)

    const corpo = await graph('escopos do token', url.toString())
    const dados = (corpo.data ?? {}) as { scopes?: string[] }
    return Array.isArray(dados.scopes) ? dados.scopes : []
}

/**
 * A permissão sem a qual o canal existe no papel e não atende.
 *
 * Conferida **antes** de gravar a linha: uma integração "conectada" que não
 * recebe mensagem é pior que uma conexão recusada, porque a clínica só descobre
 * quando um paciente não é respondido.
 */
export const PERMISSAO_DE_MENSAGENS = 'instagram_manage_messages'

export function faltaPermissaoDeMensagens(escopos: string[]): boolean {
    return !escopos.includes(PERMISSAO_DE_MENSAGENS)
}

/**
 * As permissões sem as quais este fluxo não funciona, e o que cada uma faz.
 *
 * A lista é curta de propósito: pedir permissão que não se usa trava revisão de
 * aplicativo e faz a clínica desistir na janela de consentimento. As quatro
 * primeiras são o que este código chama — `pages_show_list` entra porque somos
 * nós que listamos as Páginas para descobrir qual tem Instagram ligado.
 *
 * `pages_read_engagement` é o caso que me enganou: nós não lemos conteúdo de
 * Página nenhuma, então pela lógica do uso ela sobraria. Mas a referência da
 * Meta a declara **dependência de `instagram_manage_messages`**, junto com
 * `instagram_basic` e `pages_show_list` — e dependência não se discute, se
 * concede. Sem ela a concessão falha e o motivo aparece longe daqui.
 *
 * Fora da lista: `pages_messaging` é do Messenger, que não está no escopo, e
 * `instagram_manage_comments` é do produto de conteúdo, não do atendimento.
 */
export const PERMISSOES_NECESSARIAS: Record<string, string> = {
    instagram_basic: 'descobrir qual conta de Instagram está ligada à Página',
    instagram_manage_messages: 'receber e responder o Direct',
    pages_manage_metadata: 'assinar a Página ao aplicativo, que é o que faz o evento chegar',
    pages_show_list: 'listar as Páginas da clínica para achar a certa',
    pages_read_engagement: 'dependência declarada de instagram_manage_messages',
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

        /**
         * A lista inteira vai para o log, com o estado de cada uma.
         *
         * **Ausente e `declined` são causas diferentes com o mesmo sintoma.**
         * Ausente quer dizer que a configuração nem pediu a permissão; recusada
         * quer dizer que pediu e não obteve — e aí o problema costuma ser o
         * ativo, não a lista de permissões. Sem esta linha, as duas viram a
         * mesma frase e o conserto é tentativa e erro.
         */
        console.log(
            `[INSTAGRAM_OAUTH] permissões: ${
                lista.map((p) => `${p.permission}=${p.status}`).join(' ') || '(nenhuma)'
            }`
        )

        await registrarAtivos(tokenDeUsuario)

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
 * Sobre **quais contas** cada permissão foi concedida.
 *
 * `granular_scopes` é a parte que responde a pergunta que a lista de permissões
 * não responde: a clínica pode ter concedido `instagram_manage_messages` e não
 * ter escolhido conta nenhuma na janela — aí o escopo vem sem `target_ids`, e
 * nada funciona apesar de tudo parecer concedido. Só log; nunca atrapalha o
 * fluxo.
 */
async function registrarAtivos(tokenDeUsuario: string): Promise<void> {
    try {
        const app = await credenciaisDoApp()
        const url = new URL(`${GRAPH}/debug_token`)
        url.searchParams.set('input_token', tokenDeUsuario)
        url.searchParams.set('access_token', `${app.clientId}|${app.clientSecret}`)

        const corpo = await graph('ativos do token', url.toString())
        const dados = (corpo.data ?? {}) as {
            granular_scopes?: { scope?: string; target_ids?: string[] }[]
        }

        const resumo = (dados.granular_scopes ?? [])
            .map((g) => `${g.scope}:[${(g.target_ids ?? []).join(',') || 'sem ativo'}]`)
            .join(' ')

        console.log(`[INSTAGRAM_OAUTH] ativos concedidos: ${resumo || '(nenhum)'}`)
    } catch {
        // Diagnóstico não pode derrubar diagnóstico.
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
 * Sobre o botão invisível, que não dá erro nenhum e quebra tudo.
 *
 * A clínica precisa ligar, **no aplicativo do Instagram**, em Configurações e
 * atividade → Mensagens e respostas de story → Controles de mensagens →
 * Ferramentas conectadas → *Permitir acesso a mensagens*. Conceder a permissão
 * no OAuth **não** liga essa chave, ela não aparece em painel nenhum de
 * desenvolvedor, e com ela desligada a conexão fica verde e os envios falham
 * calados. É o equivalente, no Instagram, da assinatura de conta que nos custou
 * uma tarde no WhatsApp.
 *
 * O texto que a clínica lê **não mora aqui**: ele é passo de preparo, mostrado
 * antes do clique e lembrado depois, em `components/agents/creation/
 * InstagramConnect.tsx`. Esta nota existe para quem mexer neste arquivo não
 * concluir que a armadilha não está tratada.
 */

/**
 * O endereço do diálogo de consentimento da Meta.
 *
 * Sem `scope`: com `config_id`, quem define as permissões é a configuração do
 * *Login do Facebook para Empresas* no painel — mandar escopo junto é pedir
 * duas coisas diferentes e deixar a janela decidir qual vale.
 */
export async function urlDoDialogo(input: {
    configId: string
    redirectUri: string
    state: string
}): Promise<string> {
    const app = await credenciaisDoApp()

    const url = new URL('https://www.facebook.com/v23.0/dialog/oauth')
    url.searchParams.set('client_id', app.clientId)
    url.searchParams.set('config_id', input.configId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', input.state)

    return url.toString()
}
