import { NextRequest, NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// GET /api/account/workspace - Get workspace details
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        /**
         * A unidade aberta e as outras que esta pessoa pode abrir.
         *
         * As duas na mesma resposta porque quem as usa é a marca da sidebar,
         * que está em toda tela: uma segunda chamada só para saber se existe
         * uma segunda unidade custaria uma viagem por carregamento de página
         * para, em quase todo cliente, responder "não".
         */
        const [workspace, unidades] = await Promise.all([
            prisma.workspace.findUnique({
                where: { id: workspaceUser.workspaceId },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    cnpj: true,
                    address: true,
                    phone: true,
                    logo: true,
                    createdAt: true,
                }
            }),
            prisma.workspaceUser.findMany({
                where: { userId: workspaceUser.userId, isActive: true },
                orderBy: { createdAt: 'asc' },
                select: { workspace: { select: { id: true, name: true, logo: true } } },
            }),
        ])

        if (!workspace) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        return NextResponse.json({
            ...workspace,
            /** As unidades desta pessoa, para o seletor da marca. */
            unidades: unidades.map((u) => u.workspace),
        })
    } catch (error) {
        console.error('[API] Error fetching workspace:', error)
        return NextResponse.json({ error: 'Erro ao buscar dados da empresa' }, { status: 500 })
    }
}

// PATCH /api/account/workspace - Update workspace
export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        // Verify user is owner/admin of workspace
        const workspaceUser = await currentMembership()

        if (!workspaceUser || !['OWNER', 'ADMIN'].includes(workspaceUser.role)) {
            return NextResponse.json(
                { error: 'Permissão negada' },
                { status: 403 }
            )
        }

        const body = await request.json()
        const { cnpj, address, phone, logo } = body

        const workspace = await prisma.workspace.update({
            where: { id: workspaceUser.workspaceId },
            data: {
                cnpj: cnpj !== undefined ? cnpj : undefined,
                address: address !== undefined ? address : undefined,
                phone: phone !== undefined ? phone : undefined,
                logo: logo !== undefined ? logo : undefined,
            },
            select: {
                id: true,
                name: true,
                slug: true,
                cnpj: true,
                address: true,
                phone: true,
                logo: true,
            }
        })

        return NextResponse.json(workspace)
    } catch (error) {
        console.error('[API] Error updating workspace:', error)
        return NextResponse.json({ error: 'Erro ao atualizar dados da empresa' }, { status: 500 })
    }
}
