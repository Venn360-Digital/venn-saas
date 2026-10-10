import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'
import { LLMFactory } from '@/lib/llm/factory'
import { checkCredits, trackUsage } from '@/lib/llm/usage-tracker'

/** Resumir e escrever follow-up não precisam do modelo caro. */
const MODEL = 'gpt-4o-mini'

/** Quantas mensagens a sugestão lê. O fim da conversa é o que importa aqui. */
const WINDOW = 30

const SYSTEM = `Você escreve a próxima mensagem de follow-up de uma clínica odontológica para um paciente, em português do Brasil.

Regras:
- No máximo três frases. Mensagem de WhatsApp, não carta.
- Cite algo concreto da conversa — o procedimento, o que ficou combinado, o motivo da espera. É isso que separa um follow-up de um "oi, tudo bem?".
- Nunca invente preço, data, nome de procedimento ou promessa que não esteja na conversa.
- Termine com uma pergunta simples de responder.
- Trate por "você". Nada de "prezado". Sem emoji.
- Não se apresente como robô nem diga que é uma mensagem automática.

Responda SOMENTE um JSON, sem cercas de código:
{"mensagem":"...","quando":"AAAA-MM-DD","porque":"uma frase sobre por que esta é a hora e este é o assunto"}

"quando" é a data sugerida para o retorno caso o paciente não responda: dois dias úteis à frente, no máximo sete.`

/**
 * O texto do follow-up, escrito pela IA — e enviado por uma pessoa.
 *
 * Lê o que já está no sistema: as últimas mensagens da conversa, a fase atual
 * com a sua data e nota, e o título do negócio. É por isso que a sugestão cita
 * o que foi combinado em vez de ser um texto genérico com o nome trocado.
 *
 * Devolve sempre duas coisas — a mensagem e a data do próximo toque —, porque
 * escrever sem marcar o retorno é como o follow-up se perde hoje.
 *
 * Não envia nada. Quem envia é quem leu.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const deal = await prisma.deal.findFirst({
        where: { id, workspaceId: auth.member.workspaceId },
        select: {
            id: true,
            title: true,
            value: true,
            createdAt: true,
            contact: { select: { id: true, name: true, phone: true } },
            stage: { select: { id: true, name: true } },
            stageEntries: { orderBy: { enteredAt: 'desc' }, take: 1, select: { enteredAt: true, note: true } },
            workspace: { select: { name: true } },
        },
    })
    if (!deal) return NextResponse.json({ error: 'Negócio não encontrado' }, { status: 404 })

    const credits = await checkCredits(auth.member.workspaceId)
    if (!credits.hasCredits) {
        return NextResponse.json(
            { error: 'Sem créditos de IA. Compre créditos em Plano e créditos para usar a sugestão.' },
            { status: 402 }
        )
    }

    // A conversa deste paciente, se houver — é dela que sai o "algo concreto".
    const messages = deal.contact?.id
        ? await prisma.message.findMany({
            where: {
                conversation: { workspaceId: auth.member.workspaceId, contactId: deal.contact.id },
                isInternal: false,
            },
            orderBy: { createdAt: 'desc' },
            take: WINDOW,
            select: { direction: true, content: true, transcript: true, contentType: true, createdAt: true },
        })
        : []

    const transcript = [...messages]
        .reverse()
        .map((m) => {
            const who = m.direction === 'inbound' ? 'Paciente' : 'Clínica'
            const body = m.transcript?.trim() || m.content?.trim() || `[${m.contentType}]`
            return `${m.createdAt.toISOString().slice(0, 10)} ${who}: ${body}`
        })
        .join('\n')

    const entry = deal.stageEntries[0]
    const idleDays = entry
        ? Math.floor((Date.now() - entry.enteredAt.getTime()) / 86_400_000)
        : Math.floor((Date.now() - deal.createdAt.getTime()) / 86_400_000)

    const context = [
        `Clínica: ${deal.workspace.name}`,
        `Paciente: ${deal.contact?.name || 'sem nome cadastrado'}`,
        `Assunto do negócio: ${deal.title}`,
        `Fase atual: ${deal.stage?.name ?? '—'} (há ${idleDays} dias)`,
        entry?.note ? `Nota da fase: ${entry.note}` : null,
        `Hoje: ${new Date().toISOString().slice(0, 10)}`,
        '',
        transcript
            ? `Conversa (mais antiga primeiro):\n${transcript}`
            : 'Não há conversa registrada com este paciente. Escreva uma primeira retomada curta, sem inventar histórico.',
    ]
        .filter(Boolean)
        .join('\n')

    try {
        const llm = LLMFactory.create('openai', { model: MODEL, temperature: 0.6, maxTokens: 400 })
        const result = await llm.generate([
            { role: 'system', content: SYSTEM },
            { role: 'user', content: context },
        ])

        await trackUsage('openai', MODEL, result.usage, {
            workspaceId: auth.member.workspaceId,
            metadata: { kind: 'follow_up_suggestion', dealId: deal.id },
        })

        const parsed = parseSuggestion(result.content)
        if (!parsed) {
            return NextResponse.json({ error: 'A sugestão veio num formato inesperado. Tente de novo.' }, { status: 502 })
        }

        return NextResponse.json({
            ...parsed,
            /** Avisa a tela quando não havia histórico para citar. */
            withoutHistory: transcript.length === 0,
        })
    } catch (error) {
        console.error('[FOLLOW_UP_SUGGESTION] falhou:', error)
        return NextResponse.json({ error: 'Não foi possível gerar a sugestão agora' }, { status: 502 })
    }
}

/**
 * Lê o JSON do modelo sem confiar nele.
 *
 * Modelos devolvem cercas de código, prosa antes do objeto e aspas tortas. Em
 * vez de `JSON.parse` direto — que transforma um deslize de formatação em erro
 * 500 —, o primeiro objeto do texto é extraído e validado campo a campo.
 */
function parseSuggestion(raw: string): { message: string; when: string | null; why: string } | null {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) return null

    try {
        const data = JSON.parse(raw.slice(start, end + 1))
        const message = String(data.mensagem ?? '').trim()
        if (!message) return null

        const when = typeof data.quando === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.quando)
            ? data.quando
            : null

        return { message, when, why: String(data.porque ?? '').trim() }
    } catch {
        return null
    }
}
