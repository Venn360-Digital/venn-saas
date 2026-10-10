import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

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

class UnsupportedFile extends Error {}

/**
 * Extrai o texto do arquivo — é o texto que vira cérebro, não o arquivo.
 *
 * Imagem e planilha ficaram de fora porque extrair delas exige OCR e um
 * leitor de XLSX, que o projeto não tem. Aceitar e ignorar seria pior: o
 * arquivo apareceria na lista e o agente nunca saberia o que havia nele.
 */
async function extractText(file: File): Promise<string> {
    const name = file.name.toLowerCase()
    const buffer = Buffer.from(await file.arrayBuffer())

    if (name.endsWith('.pdf')) {
        const { PDFParse } = await import('pdf-parse')
        const parser = new PDFParse({ data: new Uint8Array(buffer) })
        try {
            const result = await parser.getText()
            return result.text
        } finally {
            await parser.destroy()
        }
    }

    if (name.endsWith('.docx')) {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ buffer })
        return result.value
    }

    if (/\.(txt|md|markdown|csv|json)$/.test(name)) {
        return buffer.toString('utf8')
    }

    throw new UnsupportedFile(
        name.endsWith('.doc')
            ? 'Formato .doc antigo não é lido. Salve como .docx ou PDF.'
            : 'Formato não suportado. Envie PDF, DOCX, TXT, MD ou CSV.'
    )
}

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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return new NextResponse('Unauthorized', { status: 401 })

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

        const raw = (await extractText(file)).replace(/\s+\n/g, '\n').trim()
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
        if (error instanceof UnsupportedFile) {
            return NextResponse.json({ error: error.message }, { status: 415 })
        }
        console.error('[KNOWLEDGE_EXTRACT]', error)
        return NextResponse.json({ error: 'Não foi possível ler o arquivo.' }, { status: 500 })
    }
}
