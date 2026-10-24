import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { MANAGER_ROLES, requireRole } from '@/lib/auth/workspace'
import { htmlToText, isPrivateHost, pageTitle } from '@/lib/rag/page-text'

export const runtime = 'nodejs'

/**
 * Lê o texto de uma página para o Cérebro do agente.
 *
 * Antes, acrescentar um site guardava a URL numa linha com `content` vazio e
 * sem vetor: a página nunca era lida, e a clínica ficava com a impressão de que
 * o agente conhecia o site. Era a fonte mais enganosa do Cérebro, porque é
 * exatamente onde estão serviços e preços.
 *
 * Uma página por vez, não um rastreamento do site — o que a tela oferece é "adicione
 * um endereço", e varrer um domínio inteiro é outro trabalho (e outra conta de
 * embedding). A tela diz isso.
 *
 * O texto é devolvido para a tela, como no upload de arquivo, e segue para a fila
 * de indexação quando o agente é salvo. Assim a clínica vê quanto foi lido antes
 * de gravar, em vez de descobrir depois que a página era um carrossel de imagens.
 */

const schema = z.object({ url: z.string().url() })

/** Igual ao teto do upload: acima disto não é base de conhecimento, é acervo. */
const MAX_CHARS = 200_000
/** Teto do download, antes de extrair. */
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 15_000

export async function POST(request: NextRequest) {
    try {
        // Só gestão: quem monta a base de conhecimento é quem administra, e
        // esta rota faz o servidor buscar uma URL escolhida por quem chama.
        const auth = await requireRole(MANAGER_ROLES)
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        const { url } = schema.parse(await request.json())
        const target = new URL(url)

        /**
         * Só http(s), e nada de endereço interno.
         *
         * A URL vem de um campo de texto e é buscada pelo nosso servidor, que
         * fala com o Postgres e o Redis na mesma rede. Sem esta
         * guarda, "adicione um site" é um pedido para o servidor buscar
         * `http://localhost:8000` ou o metadata da nuvem e devolver o conteúdo.
         */
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            return NextResponse.json(
                { error: 'Endereço inválido. Use http:// ou https://.' },
                { status: 400 }
            )
        }

        if (isPrivateHost(target.hostname)) {
            return NextResponse.json(
                { error: 'Esse endereço não é público. Informe o site da clínica.' },
                { status: 400 }
            )
        }

        const response = await fetch(target, {
            redirect: 'follow',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: {
                // Algumas hospedagens devolvem 403 para cliente sem identificação.
                'User-Agent': 'OdontoBox360/1.0 (+leitor de base de conhecimento)',
                Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
            },
        }).catch(() => null)

        if (!response) {
            return NextResponse.json(
                { error: 'Não foi possível acessar o endereço. Verifique se ele está no ar.' },
                { status: 502 }
            )
        }

        if (!response.ok) {
            return NextResponse.json(
                { error: `O site respondeu ${response.status}. Verifique o endereço.` },
                { status: 502 }
            )
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
            return NextResponse.json(
                { error: 'O endereço não devolveu uma página de texto. PDF deve ser enviado em Arquivos.' },
                { status: 415 }
            )
        }

        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > MAX_BYTES) {
            return NextResponse.json(
                { error: `A página passa de ${MAX_BYTES / 1024 / 1024} MB.` },
                { status: 413 }
            )
        }

        const html = new TextDecoder('utf-8').decode(buffer)
        const raw = /text\/plain/i.test(contentType) ? html.trim() : htmlToText(html)

        if (raw.length < 50) {
            return NextResponse.json(
                {
                    error:
                        'Quase nenhum texto nesta página. Se o conteúdo é carregado por script, ' +
                        'cole o texto numa FAQ ou envie um arquivo.',
                },
                { status: 422 }
            )
        }

        const truncated = raw.length > MAX_CHARS

        return NextResponse.json({
            url: target.toString(),
            title: pageTitle(html, target.hostname),
            chars: Math.min(raw.length, MAX_CHARS),
            truncated,
            content: truncated ? raw.slice(0, MAX_CHARS) : raw,
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Endereço inválido.' }, { status: 400 })
        }
        console.error('[KNOWLEDGE_FETCH_URL]', error)
        return NextResponse.json({ error: 'Não foi possível ler a página.' }, { status: 500 })
    }
}

