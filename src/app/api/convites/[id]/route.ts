import { NextRequest, NextResponse } from 'next/server'

import { APP } from '@/config/app.config'
import { BRAND } from '@/config/brand'
import { MANAGER_ROLES, requireRole } from '@/lib/auth/workspace'
import { TEMPLATES } from '@/lib/email/templates'
import { estadoDoConvite, podeReenviar, podeRevogar, vencimentoDe } from '@/lib/convite/estado'
import prisma from '@/lib/prisma'
import { sendEmail } from '@/lib/email/send'
import { sortearToken } from '@/lib/convite/token'

/**
 * Reenviar e revogar um convite.
 *
 * `PATCH` com `{ acao: 'reenviar' | 'revogar' }` em vez de duas rotas: as duas
 * mexem na mesma linha e compartilham a mesma busca e o mesmo portão, e um
 * `DELETE` para revogar mentiria — revogar **não apaga**, deixa o registro de
 * que houve um convite e que ele foi cancelado.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await requireRole(MANAGER_ROLES)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json().catch(() => null)
    const acao = body?.acao
    if (acao !== 'reenviar' && acao !== 'revogar') {
        return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
    }

    // `workspaceId` no `where`: convite de outra unidade não existe para esta.
    const convite = await prisma.invite.findFirst({
        where: { id, workspaceId: auth.member.workspaceId },
        select: {
            id: true,
            email: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            workspace: { select: { name: true } },
        },
    })
    if (!convite) return NextResponse.json({ error: 'Convite não encontrado' }, { status: 404 })

    const agora = new Date()
    const estado = estadoDoConvite(convite, agora)

    if (acao === 'revogar') {
        if (!podeRevogar(convite, agora)) {
            return NextResponse.json(
                {
                    error:
                        estado === 'aceito'
                            ? 'Essa pessoa já entrou. Para tirar o acesso, desative o usuário.'
                            : 'Esse convite já está revogado.',
                },
                { status: 409 }
            )
        }
        await prisma.invite.update({ where: { id }, data: { revokedAt: agora } })
        return NextResponse.json({ estado: 'revogado' })
    }

    if (!podeReenviar(convite, agora)) {
        return NextResponse.json(
            {
                error:
                    estado === 'aceito'
                        ? 'Essa pessoa já entrou.'
                        : 'Esse convite foi cancelado. Convide de novo em vez de reenviar.',
            },
            { status: 409 }
        )
    }

    /**
     * Reenviar **sorteia outro token**, e é isso que invalida o anterior.
     *
     * Não há como reenviar o mesmo link: o servidor nunca o guardou, só o
     * resumo. Trocar o resumo é o que mata o link antigo — então um e-mail
     * perdido na caixa de alguém deixa de abrir a porta no instante do
     * reenvio, o que é a propriedade que se quer.
     */
    const { token, tokenHash } = await sortearToken()
    const atualizado = await prisma.invite.update({
        where: { id },
        data: { tokenHash, expiresAt: vencimentoDe(agora) },
        select: { expiresAt: true },
    })

    const url = `${APP.url}/convite/${token}`
    void sendEmail({
        to: convite.email,
        subject: `Você foi convidado para o ${BRAND.name}`,
        html: TEMPLATES.inviteMember(url, convite.workspace.name),
    }).catch((erro) => console.error('[CONVITE] falha ao reenviar', erro))

    return NextResponse.json({ estado: 'pendente', expiresAt: atualizado.expiresAt })
}
