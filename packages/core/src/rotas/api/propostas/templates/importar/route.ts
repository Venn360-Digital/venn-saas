import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { ehFormatoLegivel, extrairTexto, normalizarExtraido } from '@venn/core/lib/documentos/extrair'
import { ehTipoDeDocumento } from '@venn/core/lib/propostas/estados'
import { lerDocumentoImportado } from '@venn/core/lib/propostas/modelo-ia'
import { vocab } from '@venn/core/lib/vocabulario'

/**
 * Importar um documento que a organização já usa, como modelo.
 *
 * `.docx`, `.pdf` ou `.xlsx`, lidos pelo extrator que o acervo dos agentes já
 * usa (`lib/documentos/extrair.ts`); a IA divide em seções e **sugere** os
 * dados que variam. Nada é trocado aqui: as sugestões voltam para a pessoa
 * confirmar no canvas, uma a uma.
 *
 * Cria o modelo inativo, como o gerado por IA — para revisão antes de aparecer
 * no seletor.
 */
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(request: NextRequest) {
    try {
        const membro = await currentMembership()
        if (!membro) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) return NextResponse.json({ error: writable.error }, { status: writable.status })
        if (!hasEditorRole(membro.role)) return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })

        const form = await request.formData()
        const arquivo = form.get('arquivo')
        const kindBruto = String(form.get('kind') ?? 'proposta')
        const kind = ehTipoDeDocumento(kindBruto) ? kindBruto : 'proposta'

        if (!(arquivo instanceof File)) return NextResponse.json({ error: 'Envie um arquivo no campo "arquivo".' }, { status: 400 })
        if (arquivo.size > MAX_BYTES) return NextResponse.json({ error: `Arquivo acima de ${MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 })
        if (!ehFormatoLegivel(arquivo.name)) {
            return NextResponse.json({ error: 'Formato não lido. Envie .docx, .pdf ou .xlsx.' }, { status: 415 })
        }

        const bytes = new Uint8Array(await arquivo.arrayBuffer())
        let texto: string
        try {
            texto = normalizarExtraido(await extrairTexto(bytes, arquivo.name))
        } catch (erro) {
            // `extrairTexto` fala em português quando o formato é o antigo
            // (.doc, .xls); o resto é "não deu para ler".
            const msg = erro instanceof Error ? erro.message : 'Não foi possível ler o arquivo.'
            return NextResponse.json({ error: msg }, { status: 422 })
        }

        const unidade = await prisma.workspace.findUnique({ where: { id: membro.workspaceId }, select: { settings: true } })
        const resultado = await lerDocumentoImportado({
            workspaceId: membro.workspaceId,
            tipo: kind,
            vocabulario: vocab(unidade?.settings),
            texto,
            nomeDoArquivo: arquivo.name,
        })
        if (!resultado.ok) return NextResponse.json({ error: resultado.motivo }, { status: 422 })

        let nome = resultado.nome
        for (let n = 2; await prisma.proposalTemplate.findFirst({ where: { workspaceId: membro.workspaceId, name: nome }, select: { id: true } }); n++) {
            nome = `${resultado.nome} (${n})`
        }

        const modelo = await prisma.proposalTemplate.create({
            data: {
                workspaceId: membro.workspaceId,
                name: nome,
                kind,
                sections: resultado.secoes,
                isDefault: false,
                isActive: false,
                // Rastreabilidade, não conteúdo: de onde veio e quando.
                source: { origem: 'importado', arquivo: arquivo.name, bytes: arquivo.size, em: new Date().toISOString() },
            },
            select: { id: true, name: true, kind: true },
        })

        return NextResponse.json({ ...modelo, secoes: resultado.secoes, sugestoes: resultado.sugestoes }, { status: 201 })
    } catch (error) {
        console.error('[MODELO_IMPORTAR]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
