import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'

/**
 * Os grupos do catálogo.
 *
 * ## Por que isto deixou de ser texto livre
 *
 * `ProductService.group` era uma coluna de texto, e texto livre produz
 * "Implantes", "implante" e "Implantes " como três grupos na mesma unidade —
 * cada um com os seus itens, nenhum deles com todos. O seletor da proposta e o
 * agrupamento do catálogo ficam inúteis.
 *
 * A coluna antiga **fica**, preenchida: é o que a coluna GERADA `searchText`
 * indexa (ver a migração `20261010100000_accent_insensitive_search`), e é o que
 * os filtros antigos usam. A migração do módulo semeou um registro por valor
 * distinto e ligou os itens.
 */

const grupoSchema = z.object({
    name: z.string().min(1, 'O nome é obrigatório').max(100),
    /** Ordem na tela: o catálogo se lê na ordem do atendimento, não do alfabeto. */
    order: z.number().int().min(0).max(9999).default(0),
})

export async function GET() {
    try {
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const grupos = await prisma.productGroup.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
            select: {
                id: true,
                name: true,
                order: true,
                // Quantos itens tem cada grupo: é o que permite à tela oferecer
                // "apagar" sem o usuário descobrir depois que levou vinte itens
                // consigo — e eles não vão, porque a FK é `SetNull`.
                _count: { select: { products: true } },
            },
        })

        return NextResponse.json({ data: grupos })
    } catch (error) {
        console.error('[PRODUCT_GRUPOS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        // Catálogo é configuração da unidade, compartilhada por todo operador.
        if (!hasEditorRole(membro.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const dados = grupoSchema.parse(await request.json())

        const grupo = await prisma.productGroup.create({
            data: { workspaceId: membro.workspaceId, name: dados.name, order: dados.order },
            select: { id: true, name: true, order: true },
        })

        return NextResponse.json(grupo, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        // `@@unique([workspaceId, name])`: nome repetido é erro de quem
        // preencheu, e 409 com a frase é mais útil que 500.
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error as { code?: string }).code === 'P2002'
        ) {
            return NextResponse.json({ error: 'Já existe um grupo com este nome.' }, { status: 409 })
        }
        console.error('[PRODUCT_GRUPOS_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
