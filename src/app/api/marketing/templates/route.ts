import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { linhasDeBroadcast } from '@/lib/marketing/lines'
import { sincronizarTemplates, variaveisDoTemplate } from '@/lib/marketing/templates'

const syncSchema = z.object({ integrationId: z.string().min(1) })

// GET — os templates espelhados + as linhas oficiais disponíveis para sincronizar.
export async function GET() {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const [templates, linhas] = await Promise.all([
        prisma.whatsAppTemplate.findMany({
            where: { workspaceId: member.workspaceId },
            orderBy: [{ status: 'asc' }, { metaName: 'asc' }],
        }),
        linhasDeBroadcast(member.workspaceId),
    ])

    return NextResponse.json({
        linhas,
        templates: templates.map((t) => ({
            id: t.id,
            metaName: t.metaName,
            language: t.language,
            category: t.category,
            status: t.status,
            integrationId: t.integrationId,
            variaveis: variaveisDoTemplate(t.components),
            syncedAt: t.syncedAt,
        })),
    })
}

// POST — sincroniza os templates aprovados de uma linha oficial com a Meta.
export async function POST(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    let data: z.infer<typeof syncSchema>
    try {
        data = syncSchema.parse(await request.json())
    } catch (e) {
        if (e instanceof z.ZodError) return NextResponse.json({ errors: e.issues }, { status: 400 })
        throw e
    }

    try {
        const { total } = await sincronizarTemplates(member.workspaceId, data.integrationId)
        return NextResponse.json({ total })
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Falha ao sincronizar'
        return NextResponse.json({ error: msg }, { status: 502 })
    }
}
