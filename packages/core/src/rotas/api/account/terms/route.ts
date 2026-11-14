import { NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { TERMS_VERSION } from '@venn/core/lib/terms'

/**
 * O aceite dos termos, registrado de dentro do produto.
 *
 * Existia um caminho só para isso — terminar o onboarding —, e ele não serve
 * para quem já opera: a conta anterior à migração que criou `terms_acceptances`
 * não tem aceite porque não havia onde gravar, e mandá-la refazer o cadastro
 * para colher uma assinatura é cobrar o preço errado pela coisa certa (ver
 * `check-workspace`, `TERMS_RECORDED_SINCE`). Aqui a clínica continua onde está
 * e assina.
 *
 * `upsert` por (usuário, workspace, versão): clicar duas vezes não cria dois
 * aceites, e uma versão nova dos termos é um registro novo em vez de sobrescrever
 * o que a pessoa aceitou antes — o histórico é o que dá valor ao aceite.
 */
export async function POST() {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        await prisma.termsAcceptance.upsert({
            where: {
                userId_workspaceId_version: {
                    userId: auth.member.userId,
                    workspaceId: auth.member.workspaceId,
                    version: TERMS_VERSION,
                },
            },
            create: {
                userId: auth.member.userId,
                workspaceId: auth.member.workspaceId,
                version: TERMS_VERSION,
            },
            update: {},
        })

        return NextResponse.json({ ok: true, version: TERMS_VERSION })
    } catch (error) {
        console.error('[TERMS_ACCEPT]', error)
        return NextResponse.json(
            { error: 'Não foi possível registrar o aceite' },
            { status: 500 }
        )
    }
}
