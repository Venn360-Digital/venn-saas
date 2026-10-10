import prisma from '@/lib/prisma'
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

export interface FollowUpSuggestion {
    message: string
    when: string | null
    why: string
    withoutHistory: boolean
}

export type SuggestionResult =
    | { ok: true; suggestion: FollowUpSuggestion }
    | { ok: false; reason: 'not_found' | 'no_credits' | 'failed' | 'bad_format' }

/**
 * A próxima mensagem deste negócio, escrita pela IA.
 *
 * Vive fora da rota porque dois caminhos precisam dela: o botão no painel, onde
 * uma pessoa lê antes de enviar, e o envio automático por fase, onde ninguém
 * lê. Uma função só garante que o texto que a clínica aprovou no ensaio é o
 * mesmo que sai depois — duas cópias divergiriam no primeiro ajuste de prompt.
 */
export async function buildFollowUpSuggestion(
    dealId: string,
    workspaceId: string
): Promise<SuggestionResult> {
    const deal = await prisma.deal.findFirst({
        where: { id: dealId, workspaceId },
        select: {
            id: true,
            title: true,
            createdAt: true,
            contact: { select: { id: true, name: true } },
            stage: { select: { name: true } },
            stageEntries: { orderBy: { enteredAt: 'desc' }, take: 1, select: { enteredAt: true, note: true } },
            workspace: { select: { name: true } },
        },
    })
    if (!deal) return { ok: false, reason: 'not_found' }

    const credits = await checkCredits(workspaceId)
    if (!credits.hasCredits) return { ok: false, reason: 'no_credits' }

    const messages = deal.contact?.id
        ? await prisma.message.findMany({
            where: {
                conversation: { workspaceId, contactId: deal.contact.id },
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
    const since = entry?.enteredAt ?? deal.createdAt
    const idleDays = Math.floor((Date.now() - since.getTime()) / 86_400_000)

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
            workspaceId,
            metadata: { kind: 'follow_up_suggestion', dealId: deal.id },
        })

        const parsed = parseSuggestion(result.content)
        if (!parsed) return { ok: false, reason: 'bad_format' }

        return { ok: true, suggestion: { ...parsed, withoutHistory: transcript.length === 0 } }
    } catch (error) {
        console.error('[FOLLOW_UP_SUGGESTION] falhou:', error)
        return { ok: false, reason: 'failed' }
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
