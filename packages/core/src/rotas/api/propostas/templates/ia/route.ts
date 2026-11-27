import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { TIPOS_DE_DOCUMENTO } from '@venn/core/lib/propostas/estados'
import { montarModelo } from '@venn/core/lib/propostas/modelo-ia'
import { vocab } from '@venn/core/lib/vocabulario'

/**
 * A IA monta um modelo inteiro — passo 2 de "modelo primeiro".
 *
 * Cria o modelo **inativo e não padrão**: ele nasce para a pessoa revisar no
 * canvas (passo 3, marcar o que varia; preencher os compromissos em branco) e
 * só depois ativar. Um modelo gerado que já aparecesse no seletor de novo
 * documento poria texto não revisado na frente do vendedor.
 */
const schema = z.object({
    kind: z.enum(TIPOS_DE_DOCUMENTO).default('proposta'),
    descricao: z.string().min(10, 'Descreva um pouco mais').max(4000),
})

export async function POST(request: NextRequest) {
    try {
        const membro = await currentMembership()
        if (!membro) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) return NextResponse.json({ error: writable.error }, { status: writable.status })

        // Modelo é configuração da unidade — a mesma regra da tela de modelos.
        if (!hasEditorRole(membro.role)) return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })

        const dados = schema.parse(await request.json())
        const unidade = await prisma.workspace.findUnique({ where: { id: membro.workspaceId }, select: { settings: true } })

        const resultado = await montarModelo({
            workspaceId: membro.workspaceId,
            tipo: dados.kind,
            vocabulario: vocab(unidade?.settings),
            descricao: dados.descricao,
        })
        // 422: a chamada funcionou e a resposta não serviu — motivo legível.
        if (!resultado.ok) return NextResponse.json({ error: resultado.motivo }, { status: 422 })

        // O nome tem de ser único por unidade: numera se já houver.
        let nome = resultado.nome
        for (let n = 2; await prisma.proposalTemplate.findFirst({ where: { workspaceId: membro.workspaceId, name: nome }, select: { id: true } }); n++) {
            nome = `${resultado.nome} (${n})`
        }

        const modelo = await prisma.proposalTemplate.create({
            data: {
                workspaceId: membro.workspaceId,
                name: nome,
                kind: dados.kind,
                sections: resultado.secoes,
                isDefault: false,
                isActive: false,
                source: { origem: 'ia', descricao: dados.descricao.slice(0, 500), em: new Date().toISOString() },
            },
            select: { id: true, name: true, kind: true },
        })

        // As seções voltam inteiras: a tela abre o modelo recém-nascido no canvas sem outra ida ao servidor.
        return NextResponse.json({ ...modelo, secoes: resultado.secoes }, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ errors: error.issues }, { status: 400 })
        console.error('[MODELO_IA]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
