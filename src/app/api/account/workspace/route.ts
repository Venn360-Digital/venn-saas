import { NextResponse } from 'next/server'
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
                    createdAt: true,
                    /**
                     * A logomarca vem da **conta**, não da unidade.
                     *
                     * É quem desenha o cabeçalho do sistema, e lida da unidade
                     * ela mudaria ao trocar de clínica — justamente a parte da
                     * tela que não pode mudar. A coluna `workspaces.logo`
                     * continua existindo e deixou de ser lida aqui.
                     */
                    account: { select: { logo: true, name: true } },
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

        const { account, ...daUnidade } = workspace

        return NextResponse.json({
            ...daUnidade,
            /** A marca do cabeçalho: da conta. Ver o `select` acima. */
            logo: account.logo,
            conta: account.name,
            /** As unidades desta pessoa, para o seletor da marca. */
            unidades: unidades.map((u) => u.workspace),
        })
    } catch (error) {
        console.error('[API] Error fetching workspace:', error)
        return NextResponse.json({ error: 'Erro ao buscar dados da empresa' }, { status: 500 })
    }
}
