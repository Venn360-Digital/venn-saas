import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { MAXIMO_DE_VARIACOES, gerarCapa } from '@venn/core/lib/propostas/capa'

/**
 * Gera as artes da capa de um modelo — até três de uma vez — e devolve as
 * opções. **Não grava**: quem escolhe é a pessoa, na tela, e a escolha entra
 * na seção `capa` pela gravação automática do modelo. Gravar aqui a primeira
 * das três seria escolher por ela.
 */
const schema = z.object({
    /** Do que trata, para a arte ter assunto. Vazio usa o nome do modelo. */
    assunto: z.string().max(300).nullable().optional(),
    /** Cor principal em hex. Vazio usa a da organização, quando houver tema. */
    cor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable()
        .optional(),
    /** Quantas artes, para escolher. Padrão: três. */
    variacoes: z.number().int().min(1).max(MAXIMO_DE_VARIACOES).default(MAXIMO_DE_VARIACOES),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const membro = await currentMembership()
        if (!membro) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) return NextResponse.json({ error: writable.error }, { status: writable.status })
        if (!hasEditorRole(membro.role)) return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })

        const modelo = await prisma.proposalTemplate.findFirst({
            where: { id, workspaceId: membro.workspaceId },
            select: { id: true, name: true, theme: true },
        })
        if (!modelo) return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })

        const dados = schema.parse(await request.json().catch(() => ({})))
        const tema = (modelo.theme ?? {}) as { cor?: string }

        const resultado = await gerarCapa({
            workspaceId: membro.workspaceId,
            assunto: dados.assunto?.trim() || modelo.name,
            cor: dados.cor ?? tema.cor ?? null,
            variacoes: dados.variacoes,
        })
        if (!resultado.ok) return NextResponse.json({ error: resultado.motivo }, { status: resultado.status })

        return NextResponse.json({ opcoes: resultado.opcoes, creditos: resultado.creditos })
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ errors: error.issues }, { status: 400 })
        console.error('[MODELO_CAPA]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
