import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import {
    currentMembership,
    hasEditorRole,
    PERMISSION_DENIED,
} from '@venn/core/lib/auth/workspace'
import { TIPOS_DE_DOCUMENTO } from '@venn/core/lib/propostas/estados'
import { secoesSchema } from '@venn/core/lib/propostas/secoes'
import { semearModelos } from '@venn/core/lib/propostas/semente'
import { vocab } from '@venn/core/lib/vocabulario'

/**
 * Os modelos de documento.
 *
 * Configuração da unidade, logo é de gestor acima — não de atendente. O
 * atendente **monta** proposta; o modelo é o layout que vale para todos.
 */

const modeloSchema = z.object({
    name: z.string().min(1, 'O nome é obrigatório').max(100),
    kind: z.enum(TIPOS_DE_DOCUMENTO).default('proposta'),
    /**
     * O corpo, com marcadores `{{...}}`. Texto, não HTML colado: `render.ts`
     * escapa tudo e reconhece título e lista por convenção de linha. Ver a nota
     * lá sobre por que não há editor rico neste projeto.
     */
    body: z.string().max(50_000).nullable().optional(),
    /** As seções da v2. Com elas, `body` é ignorado pelo render. */
    sections: secoesSchema.nullable().optional(),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
})

export async function GET() {
    try {
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const modelos = await prisma.proposalTemplate.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: [{ kind: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
            select: {
                id: true,
                name: true,
                kind: true,
                body: true,
                isDefault: true,
                isActive: true,
                _count: { select: { proposals: true } },
            },
        })

        return NextResponse.json({ data: modelos })
    } catch (error) {
        console.error('[PROPOSTA_TEMPLATES_GET]', error)
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

        if (!hasEditorRole(membro.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const corpo = await request.json().catch(() => ({}))

        /**
         * `{ semear: true }` restaura os modelos padrão da unidade: a escada
         * de cinco propostas (`modelos-prontos.ts`), mais um orçamento e um
         * contrato. Era três em corpo de texto até 27/11/2026.
         *
         * Mora nesta rota, e não numa própria, porque é a mesma operação de
         * criar — o que muda é quem escreve o texto. `semearModelos` é
         * idempotente (`skipDuplicates`) e **não** sobrescreve o que a unidade
         * editou: quem quiser o original de volta apaga o modelo e semeia.
         */
        if (corpo && typeof corpo === 'object' && (corpo as { semear?: unknown }).semear === true) {
            const unidade = await prisma.workspace.findUnique({
                where: { id: membro.workspaceId },
                select: { settings: true },
            })
            const criados = await prisma.$transaction((tx) =>
                semearModelos(tx, vocab(unidade?.settings), membro.workspaceId)
            )
            return NextResponse.json({ criados }, { status: 201 })
        }

        const dados = modeloSchema.parse(corpo)

        const modelo = await prisma.$transaction(async (tx) => {
            /**
             * Um padrão por tipo — o índice único parcial da migração recusaria
             * o segundo, e esta limpeza é o que faz "marcar como padrão"
             * funcionar como o usuário espera: o anterior deixa de ser.
             *
             * Sem isto, a gravação explodiria com erro de constraint e a tela
             * mostraria "erro interno" para uma ação perfeitamente razoável.
             */
            if (dados.isDefault) {
                await tx.proposalTemplate.updateMany({
                    where: { workspaceId: membro.workspaceId, kind: dados.kind, isDefault: true },
                    data: { isDefault: false },
                })
            }

            return tx.proposalTemplate.create({
                data: {
                    workspaceId: membro.workspaceId,
                    name: dados.name,
                    kind: dados.kind,
                    body: dados.body ?? null,
                    sections: dados.sections ?? undefined,
                    isDefault: dados.isDefault,
                    isActive: dados.isActive,
                },
                select: { id: true, name: true, kind: true, isDefault: true, isActive: true },
            })
        })

        return NextResponse.json(modelo, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        // Nome repetido na unidade: `@@unique([workspaceId, name])`. 409 com a
        // explicação, e não 500 — é erro de quem preencheu, não do servidor.
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error as { code?: string }).code === 'P2002'
        ) {
            return NextResponse.json({ error: 'Já existe um modelo com este nome.' }, { status: 409 })
        }
        console.error('[PROPOSTA_TEMPLATES_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
