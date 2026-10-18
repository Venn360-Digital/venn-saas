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
        const { name, cnpj, address, phone, logo } = body

        /**
         * O nome da unidade passou a ser editável em 2026-10-18.
         *
         * Era um campo desabilitado com a dica "é o identificador do workspace
         * e não muda por aqui" — verdade enquanto havia uma clínica por conta,
         * porque ninguém lia aquele nome em lugar nenhum. Com várias unidades o
         * nome é **como se distingue uma clínica da outra** no seletor da marca
         * e na lista de unidades, e a unidade criada pela tela ganha o nome
         * digitado na hora: sem isto, um erro de digitação ficava para sempre.
         *
         * O `slug` não acompanha, de propósito. Ele não aparece em rota nenhuma
         * (é promessa de subdomínio do cadastro, e nada mais lê), e mexer nele
         * trocaria a única chave estável da unidade por uma derivada de texto
         * que a clínica edita.
         */
        const nome = typeof name === 'string' ? name.trim() : undefined
        if (nome !== undefined && (nome.length < 2 || nome.length > 80)) {
            return NextResponse.json(
                { error: 'O nome da unidade precisa ter de 2 a 80 caracteres.' },
                { status: 400 }
            )
        }

        const workspace = await prisma.workspace.update({
            where: { id: workspaceUser.workspaceId },
            data: {
                name: nome,
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
