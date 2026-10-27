import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'

const createSchema = z.object({
    name: z.string().min(1),
    labels: z.array(z.string()).optional(),
    integrationId: z.string().min(1),
    templateId: z.string().min(1),
    listIds: z.array(z.string()).min(1),
    variables: z.record(z.string(), z.unknown()).optional(),
    throttlePerMin: z.number().int().positive().max(600).optional(),
})

// GET — lista as campanhas, opcionalmente por status (?status=draft|scheduled|...).
export async function GET(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const status = request.nextUrl.searchParams.get('status')
    const campanhas = await prisma.broadcast.findMany({
        where: {
            workspaceId: member.workspaceId,
            ...(status ? { status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
            template: { select: { metaName: true } },
            integration: { select: { label: true, phoneNumber: true } },
        },
    })

    return NextResponse.json(
        campanhas.map((b) => ({
            id: b.id,
            name: b.name,
            labels: b.labels,
            status: b.status,
            scheduledAt: b.scheduledAt,
            template: b.template.metaName,
            line: b.integration.label || b.integration.phoneNumber,
            totalCount: b.totalCount,
            sentCount: b.sentCount,
            failedCount: b.failedCount,
            createdAt: b.createdAt,
        }))
    )
}

// POST — cria uma campanha em rascunho. Valida que a linha é oficial e que o
// template é aprovado e desta conta.
export async function POST(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    let data: z.infer<typeof createSchema>
    try {
        data = createSchema.parse(await request.json())
    } catch (e) {
        if (e instanceof z.ZodError) return NextResponse.json({ errors: e.issues }, { status: 400 })
        throw e
    }

    // Linha tem de ser oficial e deste workspace (o QR não dispara broadcast).
    const linha = await prisma.agentIntegration.findFirst({
        where: {
            id: data.integrationId,
            channel: 'whatsapp_business',
            agent: { workspaceId: member.workspaceId },
        },
        select: { id: true },
    })
    if (!linha) {
        return NextResponse.json(
            { error: 'A linha escolhida não é um WhatsApp oficial conectado.' },
            { status: 400 }
        )
    }

    // Template tem de ser desta conta, da mesma linha, e aprovado.
    const template = await prisma.whatsAppTemplate.findFirst({
        where: {
            id: data.templateId,
            workspaceId: member.workspaceId,
            integrationId: data.integrationId,
        },
        select: { id: true, status: true },
    })
    if (!template) {
        return NextResponse.json(
            { error: 'Template não encontrado para esta linha.' },
            { status: 400 }
        )
    }
    if (template.status !== 'APPROVED') {
        return NextResponse.json(
            { error: 'O template escolhido ainda não está aprovado pela Meta.' },
            { status: 400 }
        )
    }

    // As listas têm de ser do workspace.
    const listas = await prisma.contactList.findMany({
        where: { id: { in: data.listIds }, workspaceId: member.workspaceId },
        select: { id: true },
    })
    if (listas.length === 0) {
        return NextResponse.json({ error: 'Nenhuma lista válida informada.' }, { status: 400 })
    }

    const broadcast = await prisma.broadcast.create({
        data: {
            workspaceId: member.workspaceId,
            name: data.name,
            labels: data.labels ?? [],
            integrationId: data.integrationId,
            templateId: data.templateId,
            variables: (data.variables as object) ?? undefined,
            throttlePerMin: data.throttlePerMin ?? 30,
            status: 'draft',
            lists: { create: listas.map((l) => ({ listId: l.id })) },
        },
    })

    return NextResponse.json({ id: broadcast.id }, { status: 201 })
}
