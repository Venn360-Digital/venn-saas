import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth/better-auth'

/**
 * Os endpoints do Better Auth: `/api/auth/sign-in/email`, `/sign-up/email`,
 * `/sign-out`, `/forget-password`, `/reset-password`, `/get-session`…
 *
 * **Sobre a convivência com as rotas que já moram em `/api/auth`.** Existem
 * duas — `me` e `check-workspace` —, e elas continuam atendendo: no App Router
 * um segmento estático vence um catch-all, então `/api/auth/me` nunca chega
 * aqui. A ressalva é a recíproca: qualquer rota **nova** criada sob `/api/auth`
 * e não declarada como pasta própria cai neste manipulador em silêncio, e o
 * sintoma seria um 404 vindo da biblioteca. Rota nova de autenticação da
 * aplicação vai em `/api/account`, não aqui.
 */
export const { GET, POST } = toNextJsHandler(auth)
