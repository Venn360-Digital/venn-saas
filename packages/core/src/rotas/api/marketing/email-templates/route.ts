import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { lerBlocos } from '@venn/core/lib/email/blocos'
import { blocoSchema, MAX_BLOCOS } from './schema'

/**
 * Os templates de e-mail da unidade — o conteúdo das campanhas, em blocos.
 *
 * Diferente do `whatsapp_templates` ao lado, que é **espelho** do que a Meta
 * aprovou e só se sincroniza: estes são escritos aqui, pela própria clínica, e
 * não dependem de aprovação de ninguém.
 */

const corpoSchema = z.object({
    name: z.string().trim().min(1, 'Dê um nome ao modelo'),
    subject: z.string().trim().max(200).optional().nullable(),
    preheader: z.string().trim().max(200).optional().nullable(),
    blocks: z.array(blocoSchema).max(MAX_BLOCOS, 'O e-mail ficou longo demais'),
})

export async function GET() {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const templates = await prisma.emailTemplate.findMany({
        where: { workspaceId: member.workspaceId },
        orderBy: { updatedAt: 'desc' },
    })

    return NextResponse.json(
        templates.map((t) => ({
            id: t.id,
            name: t.name,
            subject: t.subject,
            preheader: t.preheader,
            blocks: lerBlocos(t.blocks),
            updatedAt: t.updatedAt.toISOString(),
        }))
    )
}

export async function POST(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const corpo = corpoSchema.safeParse(await request.json())
    if (!corpo.success) {
        const primeiro = corpo.error.issues[0]
        // O campo volta para a tela pôr o erro abaixo dele, como manda o
        // DESIGN.md — nunca toast, nunca resumo no topo.
        return NextResponse.json(
            { error: primeiro.message, campo: primeiro.path[0] ?? null },
            { status: 400 }
        )
    }

    const criado = await prisma.emailTemplate.create({
        data: {
            workspaceId: member.workspaceId,
            name: corpo.data.name,
            subject: corpo.data.subject ?? null,
            preheader: corpo.data.preheader ?? null,
            blocks: corpo.data.blocks,
        },
    })

    return NextResponse.json({ id: criado.id }, { status: 201 })
}
