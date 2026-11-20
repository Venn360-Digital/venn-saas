import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import type { Prisma } from '@venn/db'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { novaChave } from '@venn/core/lib/widget'
import { CONFIGURACAO_PADRAO, camposIniciais } from '@venn/core/lib/formularios/schema'

/**
 * Os formulários de captura da unidade — listar e criar.
 *
 * Criar é só dar nome: o formulário nasce em rascunho, com os três campos de
 * todo lead (nome, WhatsApp, e-mail) e a configuração padrão, e a tela abre o
 * editor em seguida. Nascer pronto para publicar é o que faz "criar um
 * formulário" caber em dois cliques; o que a organização quer mudar ela muda
 * no editor.
 */

const corpo = z.object({
    name: z.string().trim().min(1, 'Dê um nome ao formulário').max(80, 'O nome passou de 80 caracteres'),
})

export async function GET() {
    const membro = await currentMembership()
    if (!membro) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(membro.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const formularios = await prisma.leadForm.findMany({
        where: { workspaceId: membro.workspaceId },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { submissions: true } } },
    })

    // A mesma projeção da casca de servidor da tela — se divergirem, a releitura
    // depois de gravar embaralha a lista.
    return NextResponse.json(
        formularios.map((f) => ({
            id: f.id,
            name: f.name,
            status: f.status,
            publicKey: f.publicKey,
            envios: f._count.submissions,
            updatedAt: f.updatedAt.toISOString(),
            createdAt: f.createdAt.toISOString(),
        }))
    )
}

export async function POST(request: NextRequest) {
    const membro = await currentMembership()
    if (!membro) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(membro.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const lido = corpo.safeParse(await request.json().catch(() => ({})))
    if (!lido.success) {
        const primeiro = lido.error.issues[0]
        return NextResponse.json({ error: primeiro.message, campo: primeiro.path[0] ?? null }, { status: 400 })
    }

    const criado = await prisma.leadForm.create({
        data: {
            workspaceId: membro.workspaceId,
            name: lido.data.name,
            // `pk_` como a chave do widget: mesmo gerador, mesma força.
            publicKey: novaChave('f'),
            status: 'draft',
            fields: camposIniciais() as unknown as Prisma.InputJsonValue,
            settings: CONFIGURACAO_PADRAO as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
    })

    return NextResponse.json({ id: criado.id }, { status: 201 })
}
