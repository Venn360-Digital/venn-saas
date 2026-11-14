import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { auth } from './better-auth'

/**
 * Quem está pedindo — e o **único** lugar que sabe como isso é descoberto.
 *
 * Antes de 2026-10-21, 80 rotas faziam a mesma coisa à mão:
 *
 *     const cliente = await createClient()
 *     const { data: { user } } = await cliente.auth.getUser()
 *     if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 *
 * Duas consequências, e nenhuma delas era intencional.
 *
 * A primeira: na maioria dessas rotas o bloco é **redundante**. O que vem
 * depois é `getWorkspaceMember()` ou `currentMembership()`, e essas funções já
 * resolvem o usuário por conta própria e já devolvem 401 quando não há sessão —
 * então a rota pagava uma ida ao provedor de identidade duas vezes por pedido
 * para chegar à mesma conclusão.
 *
 * A segunda: trocar de provedor de identidade significaria editar 80 arquivos,
 * e qualquer um esquecido seguiria falando com o provedor antigo sem erro de
 * compilação — o pior tipo de resto, porque funciona até o dia em que o
 * provedor antigo é desligado.
 *
 * Com este módulo a troca é de um arquivo. É o que a ida para o Better Auth
 * exige, e é a razão de ele existir **antes** dela: o refator fica reversível e
 * verificável sozinho, separado da mudança de provedor.
 *
 * @see src/lib/auth/workspace.ts — o que a pessoa **pode**, que é outra pergunta
 */

export interface UsuarioDaSessao {
    id: string
    /**
     * O e-mail, que é identificador de login e não dado de perfil.
     *
     * Está aqui porque três lugares precisam dele para falar com fornecedor
     * externo (cobrança) ou para conferir a senha atual, e buscá-lo no banco
     * seria uma consulta a mais para um dado que a sessão já carrega.
     */
    email: string

    /**
     * O nome que o provedor de identidade conhece, quando conhece.
     *
     * Opcional porque **é** opcional: cadastro por e-mail e senha pode não ter
     * nome, e OAuth sem escopo de perfil também não. Serve para um caso só —
     * semear `User.name` quando a linha do banco ainda não existe (ver
     * `api/agents/route.ts`) — e para esse caso um palpite do e-mail já é a
     * alternativa. Depois de criada, a fonte do nome é o banco, não a sessão:
     * quem edita o perfil não edita o provedor.
     */
    nome?: string
}

/**
 * O usuário da sessão, ou `null`.
 *
 * `null` e não exceção: "não autenticado" é resposta normal — toda rota pública
 * e toda página de login passam por aqui esperando `null`. Quem precisa de
 * erro usa `requireUsuario()`.
 *
 * **Memoizada por requisição**, e é o que a torna barata o bastante para ser
 * chamada à vontade. O layout do painel resolvia a sessão **duas vezes** por
 * navegação — `marcaDaSessao()` e `avaliacaoDaSessao()` correm em
 * `Promise.all` e cada uma chamava `getWorkspaceMember()`, que chama esta —, e
 * a página renderizada em seguida chamava de novo. Três consultas a
 * `auth_sessions` para responder à mesma pergunta, em cada troca de tela.
 *
 * `cache()` é do React e vale **só dentro da requisição**: duas pessoas nunca
 * compartilham resposta, e o pedido seguinte resolve do zero. É por isso que
 * trocar de unidade continua funcionando — `api/workspace/switch` grava o
 * cookie e **responde**; quem lê o cookie novo é a requisição seguinte, com a
 * memória já limpa.
 */
export const usuarioDaSessao = cache(async (): Promise<UsuarioDaSessao | null> => {
    /**
     * Uma consulta ao banco, não uma ida à rede.
     *
     * Era isto o que a plataforma anterior cobrava: cada `auth.getUser()` saía para o
     * serviço de identidade. Agora a sessão é linha em `auth_sessions`, no mesmo
     * Postgres do resto — resolvida pelo cookie assinado, numa junção com
     * `users`. É também o que torna o Worker viável: ida à rede por pedido, em
     * borda, é latência que não se recupera.
     */
    const sessao = await auth.api.getSession({ headers: await headers() })

    if (!sessao?.user?.id) return null

    return {
        id: sessao.user.id,
        email: sessao.user.email ?? '',
        nome: sessao.user.name?.trim() || undefined,
    }
})

export class NaoAutenticadoError extends Error {
    readonly status = 401

    constructor() {
        super('Não autenticado')
        this.name = 'NaoAutenticadoError'
    }
}

/**
 * O usuário da sessão, lançando quando não há.
 *
 * Para o punhado de lugares que precisam da identidade e **não** passam por
 * `getWorkspaceMember()` — fluxos de conta, troca de senha, onboarding, o
 * seletor de unidade.
 */
export async function requireUsuario(): Promise<UsuarioDaSessao> {
    const usuario = await usuarioDaSessao()
    if (!usuario) throw new NaoAutenticadoError()
    return usuario
}
