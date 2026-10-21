'use client'

import { createAuthClient } from 'better-auth/react'

/**
 * O cliente de autenticação do navegador.
 *
 * Substitui `@/lib/supabase/client` nos fluxos de identidade — entrar, cadastrar,
 * sair, pedir redefinição de senha. Fala com `/api/auth/*`, que é o manipulador
 * do Better Auth.
 *
 * **Sem chave no navegador.** É a diferença que menos aparece e mais importa: o
 * cliente do Supabase precisava da chave anon embutida no bundle — pública por
 * desenho, e a razão de existir todo o RLS que esta migração removeu (ver
 * `docs/migration/01-compatibility.md` §13). Aqui o navegador não carrega
 * credencial nenhuma: ele chama a própria aplicação, e quem fala com o banco é o
 * servidor.
 */
export const authClient = createAuthClient({
    /**
     * Mesma origem, então caminho relativo.
     *
     * Fixar `NEXT_PUBLIC_APP_URL` aqui quebraria os preview deploys, que mudam
     * de hostname a cada PR — e é justamente neles que o fluxo de login precisa
     * ser testado.
     */
    basePath: '/api/auth',
})

export const {
    signIn,
    signUp,
    signOut,
    useSession,
    getSession,
    /** Pede o e-mail de redefinição. Chamava-se `forgetPassword` em versões anteriores. */
    requestPasswordReset,
    resetPassword,
    changePassword,
} = authClient
