import prisma from '@venn/db/cliente'
import { LLMFactory } from './llm/factory'
import { checkCredits, spendAiCredits, trackUsage } from './llm/usage-tracker'
import { vocab, type Vocabulario } from './vocabulario'
import { vocabDoWorkspace } from './vocabulario-do-workspace'
import { comArtigo } from './concordancia'

/** Resumir e escrever follow-up não precisam do modelo caro. */
const MODEL = 'gpt-4o-mini'

/** Quantas mensagens a sugestão lê. O fim da conversa é o que importa aqui. */
const WINDOW = 30

/**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada — e a publicação reprova com
 * `MarcaNaoRegistradaError`. O `check:marca-tardia` apontou este arquivo no
 * instante em que o vocabulário entrou no prompt.
 */
/*
 * ## O cache de módulo saiu, e o adjetivo de nicho também
 *
 * Duas coisas erradas na mesma linha, achadas em 18/11/2026 ao fazer o
 * vocabulário chegar aqui:
 *
 * 1. `let systemCache` congelava o prompt na PRIMEIRA unidade a pedir uma
 *    sugestão. Todas as outras do mesmo isolate receberiam as palavras dela.
 *    Mesma forma do cache que saiu de `agent-tools.ts` no commit anterior, e
 *    das nove da Fase 3: resultado que depende do argumento não vive em cache
 *    global.
 *
 * 2. O texto dizia "de uma ORGANIZAÇÃO **odontológica**". Este arquivo mora em
 *    `packages/core` e serve os três produtos — então o gerador de follow-up
 *    dos outros dois instruía o modelo a escrever para uma clínica dentária.
 *    O adjetivo era redundante além de errado: `comArtigo(v,'organizacao','um')`
 *    já entrega "de uma clínica" ou "de uma agência", conforme a unidade.
 *
 * Sem cache, o custo é montar uma string por sugestão — ao lado de uma chamada
 * de LLM, ruído.
 */
function system(v: Vocabulario): string {
    return `Você escreve a próxima mensagem de follow-up de ${comArtigo(v, 'organizacao', 'um')} para ${comArtigo(v, 'pessoa', 'um')}, em português do Brasil.

Regras:
- No máximo três frases. Mensagem de WhatsApp, não carta.
- Cite algo concreto da conversa — ${comArtigo(v, 'servico')}, o que ficou combinado, o motivo da espera. É isso que separa um follow-up de um "oi, tudo bem?".
- Nunca invente preço, data, nome de ${v.servico} ou promessa que não esteja na conversa.
- Termine com uma pergunta simples de responder.
- Trate por "você". Nada de "prezado". Sem emoji.
- Não se apresente como robô nem diga que é uma mensagem automática.

Responda SOMENTE um JSON, sem cercas de código:
{"mensagem":"...","quando":"AAAA-MM-DD","porque":"uma frase sobre por que esta é a hora e este é o assunto"}

"quando" é a data sugerida para o retorno caso ${comArtigo(v, 'pessoa')} não responda: dois dias úteis à frente, no máximo sete.`
}

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
    target: { workspaceId: string; dealId?: string; conversationId?: string }
): Promise<SuggestionResult> {
    const { workspaceId } = target

    /*
     * O vocabulário DESTA unidade, resolvido uma vez.
     *
     * Antes aqui era `vocab()` em 14 pontos — o padrão da marca, ignorando o
     * ajuste da unidade. Isto gera a mensagem de retomada que vai ao cliente
     * final, então é texto que ele lê assinado pela empresa dele.
     *
     * Resolve por dentro, e não por parâmetro, porque `workspaceId` já chega
     * aqui e esta função já é assíncrona: pedir aos três chamadores que
     * resolvessem seria espalhar a mesma consulta por três lugares.
     */
    const v = await vocabDoWorkspace(workspaceId)

    /**
     * O alvo pode ser um negócio ou uma conversa.
     *
     * Na tela de conversas a pergunta nasce do fio aberto, e pode não haver
     * negócio nenhum ainda; no funil ela nasce do negócio. Resolver os dois
     * aqui evita duas funções que escreveriam textos diferentes com o mesmo
     * prompt.
     */
    const dealId = target.dealId ?? (target.conversationId
        ? (await prisma.conversation.findFirst({
            where: { id: target.conversationId, workspaceId },
            select: {
                contactId: true,
                contact: {
                    select: {
                        deals: {
                            where: { status: 'open' },
                            orderBy: { createdAt: 'desc' },
                            take: 1,
                            select: { id: true },
                        },
                    },
                },
            },
        }))?.contact?.deals[0]?.id ?? null
        : null)

    // Conversa sem negócio aberto ainda tem conversa: o texto sai do fio.
    if (!dealId && target.conversationId) {
        return buildFromConversation(v, target.conversationId, workspaceId)
    }
    if (!dealId) return { ok: false, reason: 'not_found' }

    const deal = await prisma.deal.findFirst({
        where: { id: dealId, workspaceId },
        select: {
            id: true,
            title: true,
            createdAt: true,
            contact: { select: { id: true, name: true } },
            stage: { select: { name: true } },
            stageEntries: { orderBy: { enteredAt: { sort: 'desc', nulls: 'last' } }, take: 1, select: { enteredAt: true, note: true } },
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
            const who = m.direction === 'inbound' ? `${v.Pessoa}` : `${v.Organizacao}`
            const body = m.transcript?.trim() || m.content?.trim() || `[${m.contentType}]`
            return `${m.createdAt.toISOString().slice(0, 10)} ${who}: ${body}`
        })
        .join('\n')

    const entry = deal.stageEntries[0]
    const since = entry?.enteredAt ?? deal.createdAt
    const idleDays = Math.floor((Date.now() - since.getTime()) / 86_400_000)

    const context = [
        `${v.Organizacao}: ${deal.workspace.name}`,
        `${v.Pessoa}: ${deal.contact?.name || 'sem nome cadastrado'}`,
        `Assunto do negócio: ${deal.title}`,
        `Fase atual: ${deal.stage?.name ?? '—'} (há ${idleDays} dias)`,
        entry?.note ? `Nota da fase: ${entry.note}` : null,
        `Hoje: ${new Date().toISOString().slice(0, 10)}`,
        '',
        transcript
            ? `Conversa (mais antiga primeiro):\n${transcript}`
            : `Não há conversa registrada com ${comArtigo(v, 'pessoa', 'este')}. Escreva uma primeira retomada curta, sem inventar histórico.`,
    ]
        .filter(Boolean)
        .join('\n')

    return generate(v, context, workspaceId, { dealId: deal.id }, transcript.length === 0)
}


/**
 * A sugestão quando só existe a conversa.
 *
 * Sem negócio não há fase nem nota de fase — sobra o que foi dito, que é o
 * essencial. Escrever "não há contexto" e desistir seria pior: é justamente a
 * conversa sem negócio aberto que costuma estar esquecida.
 */
async function buildFromConversation(
    v: Vocabulario,
    conversationId: string,
    workspaceId: string
): Promise<SuggestionResult> {
    const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId },
        select: {
            id: true,
            contact: { select: { name: true } },
            workspace: { select: { name: true } },
        },
    })
    if (!conversation) return { ok: false, reason: 'not_found' }

    const credits = await checkCredits(workspaceId)
    if (!credits.hasCredits) return { ok: false, reason: 'no_credits' }

    const messages = await prisma.message.findMany({
        where: { conversationId, isInternal: false },
        orderBy: { createdAt: 'desc' },
        take: WINDOW,
        select: { direction: true, content: true, transcript: true, contentType: true, createdAt: true },
    })

    const transcript = [...messages].reverse().map((m) => line(v, m)).join('\n')

    const context = [
        `${v.Organizacao}: ${conversation.workspace.name}`,
        `${v.Pessoa}: ${conversation.contact?.name || 'sem nome cadastrado'}`,
        `Hoje: ${new Date().toISOString().slice(0, 10)}`,
        '',
        transcript
            ? `Conversa (mais antiga primeiro):\n${transcript}`
            : 'A conversa está vazia. Escreva uma primeira retomada curta, sem inventar histórico.',
    ].join('\n')

    return generate(v, context, workspaceId, { conversationId }, transcript.length === 0)
}

/** Uma linha da transcrição — áudio entra pela transcrição, não como "[audio]". */
function line(v: Vocabulario, m: {
    direction: string
    content: string | null
    transcript: string | null
    contentType: string
    createdAt: Date
}): string {
    const who = m.direction === 'inbound' ? `${v.Pessoa}` : `${v.Organizacao}`
    const body = m.transcript?.trim() || m.content?.trim() || `[${m.contentType}]`
    return `${m.createdAt.toISOString().slice(0, 10)} ${who}: ${body}`
}

/** A chamada ao modelo, o débito e a leitura — compartilhados pelos dois alvos. */
async function generate(
    v: Vocabulario,
    context: string,
    workspaceId: string,
    metadata: Record<string, unknown>,
    withoutHistory: boolean
): Promise<SuggestionResult> {
    try {
        const llm = LLMFactory.create('openai', { model: MODEL, temperature: 0.6, maxTokens: 400 })
        const result = await llm.generate([
            { role: 'system', content: system(v) },
            { role: 'user', content: context },
        ])

        await trackUsage('openai', MODEL, result.usage, {
            workspaceId,
            metadata: { kind: 'follow_up_suggestion', ...metadata },
        })

        const parsed = parseSuggestion(result.content)
        if (!parsed) return { ok: false, reason: 'bad_format' }

        // Depois do parse, não antes: sugestão que voltou ilegível não é
        // sugestão, e o cliente não paga por ela. Uma ação de IA entregue, um
        // crédito — ver `spendAiCredits`.
        await spendAiCredits(workspaceId, 1, 'sugestão de follow-up')

        return { ok: true, suggestion: { ...parsed, withoutHistory } }
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
