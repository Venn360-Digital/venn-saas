import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { CREDITOS_POR_CAPA, gerarCapa } from '@venn/core/lib/propostas/capa'
import { secoesSchema, type Secao } from '@venn/core/lib/propostas/secoes'

/**
 * Gera a arte da capa de um modelo e a prende na seção `capa`.
 *
 * Uma imagem por chamada: a tela mostra o custo (`CREDITOS_POR_CAPA`) antes
 * e oferece "gerar outra". Sem seção `capa`, uma nasce no começo — pedir capa
 * é pedir a página.
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
            select: { id: true, name: true, sections: true, theme: true },
        })
        if (!modelo) return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })

        const dados = schema.parse(await request.json().catch(() => ({})))
        const tema = (modelo.theme ?? {}) as { cor?: string }

        const resultado = await gerarCapa({
            workspaceId: membro.workspaceId,
            assunto: dados.assunto?.trim() || modelo.name,
            cor: dados.cor ?? tema.cor ?? null,
        })
        if (!resultado.ok) return NextResponse.json({ error: resultado.motivo }, { status: resultado.status })

        const atuais = secoesSchema.safeParse(modelo.sections)
        const secoes: Secao[] = atuais.success ? [...atuais.data] : []
        const indice = secoes.findIndex((s) => s.tipo === 'capa')
        if (indice >= 0) {
            const capa = secoes[indice]
            if (capa.tipo === 'capa') secoes[indice] = { ...capa, imageKey: resultado.imageKey }
        } else {
            secoes.unshift({ id: `capa${Date.now().toString(36)}`, tipo: 'capa', imageKey: resultado.imageKey })
        }

        await prisma.proposalTemplate.update({ where: { id: modelo.id }, data: { sections: secoes } })

        return NextResponse.json({ imageKey: resultado.imageKey, url: resultado.url, creditos: CREDITOS_POR_CAPA, secoes })
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ errors: error.issues }, { status: 400 })
        console.error('[MODELO_CAPA]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
