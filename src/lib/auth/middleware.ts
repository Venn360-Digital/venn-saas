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
 * A consequência de ser otimista, dita em voz alta: um cookie **expirado ou
 * revogado** passa por este portão. Ele não passa da rota — a sessão não resolve
 * e vem 401 — então o efeito máximo é o shell do painel renderizar antes de a
 * primeira chamada falhar. É o mesmo desfecho de uma sessão que expira com a
 * aba aberta, que já acontecia. O que não pode passar é cookie **ausente**, e
 * isso é exatamente o que se verifica.
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
         */
        pathname.startsWith('/api/auth/') ||
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
