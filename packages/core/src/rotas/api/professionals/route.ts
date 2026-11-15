import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { PERMISSION_DENIED, getWorkspaceMember, hasEditorRole } from '@venn/core/lib/auth/workspace'
import { vocab } from '../../../lib/vocabulario'

/**
 * Os profissionais que executam servicos.
 *
 * Cadastro, como Departamentos e Itens — e por isso a mesma régua: ler é de
 * qualquer membro ativo, mexer é de quem edita configuração do workspace.
 */

/**
 * Função memoizada: a mensagem de erro lê o vocabulário, e o zod a avalia
 * **ao construir o schema** — numa constante de módulo isso acontece quando a
 * Cloudflare valida o script, sem marca registrada.
 */
let schemaCache: ReturnType<typeof montarSchema> | null = null
function montarSchema() {
    return z.object({
    name: z.string().trim().min(1, `Dê um nome ao ${vocab().profissional}.`).max(120),
    specialty: z.string().trim().max(120).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.').optional(),
    isActive: z.boolean().optional(),
    /** O membro do workspace que é esta pessoa, quando ela também usa o sistema. */
    userId: z.string().nullable().optional(),
})
}
function especialistaSchema() {
    if (schemaCache === null) schemaCache = montarSchema()
    return schemaCache
}

export async function GET(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { searchParams } = new URL(request.url)
    // Por padrão só os ativos: quem monta uma agenda não quer escolher entre
    // quem já saiu da clínica.
    const incluirInativos = searchParams.get('all') === 'true'

    const profissionais = await prisma.professional.findMany({
        where: {
            workspaceId: auth.member.workspaceId,
            ...(incluirInativos ? {} : { isActive: true }),
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        select: {
            id: true,
            name: true,
            specialty: true,
            color: true,
            isActive: true,
            userId: true,
            user: { select: { name: true } },
            _count: { select: { windows: true } },
        },
    })

    return NextResponse.json(
        profissionais.map((e) => ({
            id: e.id,
            name: e.name,
            specialty: e.specialty,
            color: e.color,
            isActive: e.isActive,
            userId: e.userId,
            userName: e.user?.name ?? null,
            windowCount: e._count.windows,
        }))
    )
}

export async function POST(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (!hasEditorRole(auth.member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = especialistaSchema().safeParse(body)
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
            { status: 400 }
        )
    }

    // O usuário vinculado tem que ser desta clínica — o campo vem do navegador.
    if (parsed.data.userId) {
        const membro = await prisma.workspaceUser.findFirst({
            where: { workspaceId: auth.member.workspaceId, userId: parsed.data.userId },
            select: { id: true },
        })
        if (!membro) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    const criado = await prisma.professional.create({
        data: { ...parsed.data, workspaceId: auth.member.workspaceId },
        select: { id: true, name: true },
    })

    return NextResponse.json(criado, { status: 201 })
}
