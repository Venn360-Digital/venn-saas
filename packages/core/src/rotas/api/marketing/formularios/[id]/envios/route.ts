import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { lerCampos, resumoDasRespostas, type Resposta } from '@venn/core/lib/formularios/schema'

/** Os envios de um formulário, do mais recente para o mais antigo. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const membro = await currentMembership()
    if (!membro) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(membro.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const form = await prisma.leadForm.findFirst({
        where: { id, workspaceId: membro.workspaceId },
        select: { id: true, fields: true },
    })
    if (!form) return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404 })

    const limite = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 100, 500)
    const campos = lerCampos(form.fields)

    const envios = await prisma.leadFormSubmission.findMany({
        where: { formId: form.id, workspaceId: membro.workspaceId },
        orderBy: { createdAt: 'desc' },
        take: limite,
        select: {
            id: true,
            data: true,
            pageUrl: true,
            createdAt: true,
            contact: { select: { id: true, name: true, phone: true, email: true } },
        },
    })

    return NextResponse.json({
        envios: envios.map((e) => ({
            id: e.id,
            createdAt: e.createdAt.toISOString(),
            pageUrl: e.pageUrl,
            contato: e.contact,
            // O resumo pronto, com os rótulos de hoje: a tela não precisa
            // casar id de campo com rótulo.
            resumo: resumoDasRespostas(campos, (e.data ?? {}) as Record<string, Resposta>),
        })),
    })
}
