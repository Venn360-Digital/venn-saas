import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { auth } from '@venn/core/lib/auth/better-auth'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'

/**
 * Troca a senha de quem está logado.
 *
 * Esta rota já teve dois defeitos sérios, e vale manter a história: a primeira
 * versão só escrevia `users.hashedPassword`, um hash bcrypt contra o qual nada
 * autenticava — o login ia pelo provedor de identidade anterior e pela
 * credencial dele —, então a
 * rota respondia "senha alterada" enquanto a senha antiga continuava entrando.
 * E ela pulava a conferência da senha atual sempre que aquele hash-sombra era
 * nulo, que era o caso de todo mundo que se cadastrou pela tela de login.
 *
 * **O que o Better Auth simplifica.** A versão seguinte consertava aquilo com um
 * contorno: o `updateUser` daquele provedor não conferia a senha antiga, então era
 * preciso abrir um *segundo* cliente, descartável, só para tentar um login com a
 * senha atual e ver se dava erro — e num cliente separado porque fazer o login
 * no cliente do próprio pedido rotacionaria o cookie de sessão no meio dele.
 *
 * O `changePassword` do Better Auth confere a senha atual por desenho. O
 * contorno inteiro sai: uma chamada, sem segundo cliente, sem login de
 * verificação e sem risco de mexer na sessão do pedido.
 */
export async function PATCH(request: NextRequest) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const body = await request.json()
        const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
        const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''

        if (newPassword.length < 8) {
            return NextResponse.json(
                { error: 'A nova senha deve ter pelo menos 8 caracteres' },
                { status: 400 }
            )
        }

        if (!currentPassword) {
            return NextResponse.json({ error: 'Senha atual é obrigatória' }, { status: 400 })
        }

        if (currentPassword === newPassword) {
            return NextResponse.json(
                { error: 'A nova senha deve ser diferente da atual' },
                { status: 400 }
            )
        }

        /**
         * `revokeOtherSessions` encerra as outras sessões.
         *
         * Trocar a senha é o que se faz quando se suspeita que alguém mais
         * entrou. Deixar as sessões dessa pessoa abertas tornaria a troca
         * inútil — e a sessão **deste** pedido é preservada, então quem trocou
         * não é expulso da própria tela.
         */
        try {
            await auth.api.changePassword({
                body: { currentPassword, newPassword, revokeOtherSessions: true },
                headers: await headers(),
            })
        } catch (erro) {
            /**
             * A biblioteca lança com o código; a senha errada é o caso comum e
             * tem mensagem própria. O resto não vaza texto de fornecedor para a
             * tela — vai para o log.
             */
            const codigo = (erro as { body?: { code?: string } })?.body?.code
            if (codigo === 'INVALID_PASSWORD' || codigo === 'INVALID_EMAIL_OR_PASSWORD') {
                return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 400 })
            }
            console.error('[PASSWORD_PATCH] changePassword falhou:', codigo ?? erro)
            return NextResponse.json({ error: 'Erro ao alterar senha' }, { status: 400 })
        }

        // Drop the shadow hash rather than updating it: keeping a second copy of a
        // credential that nothing authenticates against is only a liability.
        await prisma.user
            .update({ where: { id: user.id }, data: { hashedPassword: null } })
            .catch((error) => {
                // The password did change; failing to clear the old hash is not
                // worth reporting as a failure to the user.
                console.error('[PASSWORD_PATCH] Could not clear legacy hash:', error)
            })

        return NextResponse.json({ success: true, message: 'Senha alterada' })
    } catch (error) {
        console.error('[PASSWORD_PATCH] Error:', error)
        return NextResponse.json({ error: 'Erro ao alterar senha' }, { status: 500 })
    }
}
