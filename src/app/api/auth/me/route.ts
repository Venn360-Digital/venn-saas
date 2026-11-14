import { NextResponse } from 'next/server'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'
import prisma from '@venn/db/cliente'
import { enderecoDoRetrato } from '@venn/core/lib/retratos'
import { MINUTOS_PARA_AUSENTE_PADRAO } from '@venn/core/lib/automations'
import { estadoVisivel, type StatusDoMembro } from '@venn/core/lib/conversas/distribuicao'

export async function GET() {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user data with workspace info
        const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: {
                id: true,
                email: true,
                name: true,
                updatedAt: true,
            }
        })

        // A unidade escolhida, e os dados dela em seguida: quem decide qual
        // é mora em `getWorkspaceMember`, e esta rota só precisa do nome.
        const membro = await currentMembership()
        /**
         * `automations` vem junto porque o primeiro degrau da escada é
         * configurável: sem ele, a bolinha usaria o padrão e mentiria para a
         * conta que escolheu outro tempo. Uma consulta só.
         */
        const workspaceCru = membro
            ? await prisma.workspace.findUnique({
                where: { id: membro.workspaceId },
                select: { id: true, name: true, slug: true, automations: true },
            })
            : null
        const workspace = workspaceCru
            ? { id: workspaceCru.id, name: workspaceCru.name, slug: workspaceCru.slug }
            : null

        return NextResponse.json({
            user: {
                id: dbUser?.id || user.id,
                email: dbUser?.email || user.email,
                name: dbUser?.name || user.email?.split('@')[0] || 'User',
                avatar: enderecoDoRetrato('usuario', user.id, dbUser?.updatedAt),
                initials: getInitials(dbUser?.name || user.email || 'U'),
            },
            workspace: workspace || null,
            role: membro?.role || null,
            /**
             * O estado **já com a escada aplicada**, e não o que está gravado.
             *
             * É isto que impede a bolinha de mentir: quem está marcado como
             * disponível mas parado há duas horas aparece amarelo, que é o que
             * o sistema de fato usa. Mandar o valor cru repetiria o defeito da
             * primeira versão — tela dizendo uma coisa, distribuição fazendo
             * outra.
             */
            disponibilidade: membro
                ? estadoVisivel(
                      membro.status as StatusDoMembro,
                      membro.ultimaAtividadeEm,
                      membro.minutosParaAusente ?? MINUTOS_PARA_AUSENTE_PADRAO
                  )
                : null,
            recebeConversas: membro?.recebeConversas ?? false,
        })
    } catch (error) {
        console.error('[ME] Error:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
}
