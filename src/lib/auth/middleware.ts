import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * O portão de login, na borda.
 *
 * Substitui `lib/supabase/middleware.ts`. A lista de caminhos públicos veio de
 * lá **inteira**, com os motivos: cada item ali é um incidente que já
 * aconteceu, e reescrever a lista do zero seria reintroduzi-los um a um.
 *
 * **O que mudou: a verificação é otimista, e de propósito.**
 *
 * O middleware antigo chamava `supabase.auth.getUser()`, que saía para o
 * serviço de identidade **a cada pedido** — e o `matcher` abaixo cobre quase
 * todo caminho da aplicação, inclusive os que nem leem dado. Em borda isso é
 * latência que não se recupera, e em Workers é invocação paga para confirmar o
 * que a rota vai confirmar de novo.
 *
 * Então aqui só se olha se **existe** cookie de sessão válido na forma — sem ida
 * ao banco. A autorização de verdade continua onde sempre esteve:
 * `getWorkspaceMember()`, que consulta `auth_sessions`, confere a participação,
 * o `isActive` e o papel. Toda rota e toda página passam por ela.
 *
 * **Um caminho público saiu da lista:** `/email/`. Ele existia porque o GoTrue
 * do Supabase buscava os modelos de e-mail por HTTP, e sem a exceção o
 * middleware respondia àquele pedido com um redirecionamento — fazendo o HTML
 * da tela de login virar o corpo do e-mail. O GoTrue sai com o Supabase, a
 * rota `/email/` não existe mais na aplicação, e manter a exceção seria deixar
 * um caminho público aberto por um motivo que deixou de existir.
 *
 * A consequência de ser otimista, dita sem suavizar: `getSessionCookie`
 * **não verifica assinatura nenhuma**. Conferido na implementação em
 * `better-auth/dist/cookies/index.mjs` — ele lê o cabeçalho `cookie`, acha o
 * nome esperado e devolve o valor. Então não é só um cookie expirado que passa
 * por aqui: um cookie **inventado** passa.
 *
 * Por que isso ainda não é um vazamento, verificado página por página na
 * auditoria de 2026-10-21:
 *
 *   - toda página servidora deste segmento chama `getWorkspaceMember()` e
 *     redireciona quando ela falha;
 *   - o layout do painel resolve a marca por `marcaDaSessao()`, que passa pela
 *     mesma função e devolve `null`;
 *   - as páginas de cliente buscam tudo por `/api/*`, e lá a sessão é resolvida
 *     de verdade, contra `auth_sessions`.
 *
 * O efeito máximo de um cookie forjado é, portanto, carregar o esqueleto da
 * interface e ser redirecionado ou receber 401. Nenhum dado de paciente
 * atravessa.
 *
 * **Mas isso é uma invariante, não uma coincidência.** Ela se mantém enquanto
 * nenhuma página deste segmento renderizar dado sem chamar
 * `getWorkspaceMember()`. Uma página nova que leia o banco direto e confie no
 * portão vazaria — e `scripts/lint-workspace.mjs` é o que impede isso de passar
 * no build.
 */
export async function aplicarPortao(request: NextRequest): Promise<NextResponse> {
    const cookieDeSessao = getSessionCookie(request)
    const temSessao = Boolean(cookieDeSessao)

    const { pathname } = request.nextUrl

    const isPublicPath =
        /**
         * Os endpoints do próprio Better Auth: entrar, cadastrar, sair, pedir
         * redefinição. Precisam ser alcançáveis **sem** sessão — é o que eles
         * criam.
         *
         * **As duas exceções da exceção.** `/api/auth/me` e
         * `/api/auth/check-workspace` são rotas da aplicação que por acaso moram
         * sob este prefixo, e não há motivo para elas serem públicas. As duas
         * conferem a sessão por conta própria — então deixá-las na regra larga
         * não abriria nada hoje —, mas uma regra mais larga do que precisa é
         * dívida: a terceira rota que alguém criar aqui talvez não confira.
         */
        (pathname.startsWith('/api/auth/') &&
            !pathname.startsWith('/api/auth/me') &&
            !pathname.startsWith('/api/auth/check-workspace')) ||
        pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname.startsWith('/nova-senha') ||
        pathname.startsWith('/auth') ||
        // Providers post here with their own API key; they carry no session.
        pathname.startsWith('/api/webhooks/') ||
        /**
         * A volta do checkout do Asaas: uma frase e um `postMessage`.
         *
         * Pública porque não lê dado nenhum — e porque exigir sessão aqui cria
         * um desfecho ruim de verdade: se a sessão expirar enquanto a pessoa
         * paga, ela volta para uma tela de login **dentro da janelinha do
         * pagamento**, o aviso nunca chega à tela de trás, e quem pagou fica
         * olhando um "aguardando" que não termina.
         */
        pathname.startsWith('/pagamento/retorno') ||
        /**
         * O widget do site, que roda no navegador de um visitante anônimo.
         *
         * O script e a API dele são públicos por construção — quem os chama é
         * alguém que entrou no site da clínica, nunca um usuário logado. Sem
         * isto o middleware devolvia 307 no `widget.js` e 401 na API, e o
         * atendimento pelo site não funcionava em lugar nenhum.
         *
         * O que protege estas rotas não é sessão: é a chave pública não
         * autorizar nada além de iniciar uma conversa, e a chave do visitante
         * só devolver a conversa dele. Ver `src/lib/widget.ts`.
         */
        pathname === '/widget.js' ||
        pathname.startsWith('/api/widget/') ||
        // Container probe.
        pathname === '/api/health'

    if (!temSessao && !isPublicPath) {
        // API routes get a 401 rather than an HTML redirect, so a fetch from the
        // client fails as JSON instead of silently receiving a login page.
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const url = request.nextUrl.clone()
        url.pathname = '/login'
        // Preserve where they were going, so login can return them there.
        url.searchParams.set('redirectTo', pathname)
        return NextResponse.redirect(url)
    }

    // A signed-in user has no business on the login screen.
    if (temSessao && pathname.startsWith('/login')) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        url.search = ''
        return NextResponse.redirect(url)
    }

    return NextResponse.next({ request })
}
