import { NextRequest, NextResponse } from 'next/server'

import { MANAGER_ROLES, requireRole } from '@/lib/auth/workspace'
import {
    extrairTexto,
    FormatoNaoSuportado,
    normalizarExtraido,
} from '@/lib/documentos/extrair'

export const runtime = 'nodejs'

/** Teto do arquivo. Acima disto não é base de conhecimento, é acervo. */
const MAX_BYTES = 10 * 1024 * 1024
/**
 * Teto do texto extraído.
 *
 * O texto viaja para a fila de indexação dentro do payload do job, e um PDF de
 * centenas de páginas encheria o Redis com um documento só. Corta com aviso em
 * vez de recusar: as primeiras páginas de um manual já respondem quase tudo.
 */
const MAX_CHARS = 200_000


/**
 * O upload do cérebro, de verdade.
 *
 * O botão existia e fingia: esperava dois segundos, desligava o "enviando" e
 * não guardava nada — o arquivo não chegava a lugar nenhum e o agente nunca
 * ficava sabendo dele.
 *
 * Aqui o arquivo é lido, o texto é extraído e devolvido para a tela, que o
 * guarda junto do agente e o manda indexar ao salvar. O arquivo em si não é
 * guardado: o que o agente consulta é o texto, em pedaços com embedding, e
 * manter o original seria uma segunda cópia do mesmo conteúdo para alguém
 * esquecer de apagar junto.
 */
export async function POST(request: NextRequest) {
    try {
        // Gestão, como o resto do cérebro do agente: quem não pode gravar uma
        // fonte também não precisa extrair texto no servidor da clínica.
        const auth = await requireRole(MANAGER_ROLES)
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'Envie um arquivo.' }, { status: 400 })
        }
        if (file.size > MAX_BYTES) {
            return NextResponse.json(
                { error: `Arquivo acima de ${MAX_BYTES / 1024 / 1024} MB.` },
                { status: 413 }
            )
        }

        const bytes = new Uint8Array(await file.arrayBuffer())
        const raw = normalizarExtraido(await extrairTexto(bytes, file.name))
        if (!raw) {
            return NextResponse.json(
                { error: 'Nenhum texto encontrado no arquivo. PDF digitalizado precisa de OCR.' },
                { status: 422 }
            )
        }

        const truncated = raw.length > MAX_CHARS
        return NextResponse.json({
            filename: file.name,
            size: file.size,
            chars: Math.min(raw.length, MAX_CHARS),
            truncated,
            content: truncated ? raw.slice(0, MAX_CHARS) : raw,
        })
    } catch (error) {
        if (error instanceof FormatoNaoSuportado) {
            return NextResponse.json({ error: error.message }, { status: 415 })
        }
        console.error('[KNOWLEDGE_EXTRACT]', error)
        return NextResponse.json({ error: 'Não foi possível ler o arquivo.' }, { status: 500 })
    }
}
