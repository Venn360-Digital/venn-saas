import type { Agent, Message } from '@prisma/client'
import prisma from '@/lib/prisma'
import { LLMFactory } from '@/lib/llm/factory'
import { checkCredits, trackUsage } from '@/lib/llm/usage-tracker'
import type { LLMMessage, LLMProviderName, LLMResponse } from '@/types/llm'
import { DocumentRetriever } from '@/lib/rag/retriever'
import { env } from '../env'
import { createLogger } from '../logger'
import { buildSystemPrompt, readPreferences, type KnowledgeChunk } from './prompt'
import { loadConversationContext } from './conversation-context'
import { AGENT_TOOL_DEFINITIONS, runAgentTool, type AgentToolContext } from './agent-tools'

const log = createLogger('AI_REPLY')

export class OutOfCreditsError extends Error {
    constructor(workspaceId: string) {
        super(`Workspace ${workspaceId} has no AI credits left`)
        this.name = 'OutOfCreditsError'
    }
}

/**
 * Pull the knowledge chunks relevant to the latest question.
 *
 * Failure is non-fatal: answering without the knowledge base beats not answering.
 */
async function retrieveKnowledge(agentId: string, query: string): Promise<KnowledgeChunk[]> {
    if (env.AI_RAG_CHUNKS === 0 || !query.trim()) return []

    try {
        const retriever = new DocumentRetriever()
        const rows = await retriever.search(agentId, query, env.AI_RAG_CHUNKS)
        return rows
            .filter((row) => typeof row?.content === 'string')
            .map((row) => ({
                title: String(row.title ?? 'Documento'),
                content: String(row.content),
                similarity: typeof row.similarity === 'number' ? row.similarity : undefined,
            }))
    } catch (error) {
        log.warn(`knowledge retrieval failed for agent ${agentId}`, error)
        return []
    }
}

function toLlmHistory(history: Message[]): LLMMessage[] {
    return history
        // Internal operator notes are not part of the customer-facing dialogue.
        .filter((m) => !m.isInternal && m.content.trim().length > 0)
        .map((m) => ({
            role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
            // Uma nota de voz transcrita vira texto para o modelo. Sem isto ele
            // via "🎵 Áudio" e respondia sem saber o que o paciente disse.
            content: m.contentType === 'audio' && m.transcript ? `[Nota de voz] ${m.transcript}` : m.content,
        }))
}

export interface GenerateReplyInput {
    agent: Agent
    workspaceId: string
    conversationId: string
}

export interface GeneratedReply {
    content: string
    usage: LLMResponse['usage']
}

/**
 * Produce the agent's next message for a conversation.
 *
 * Unlike the previous inline implementation this gates on the workspace's credit
 * balance first — the WhatsApp path used to consume LLM tokens with no limit
 * because only `/api/llm/generate` ever called `checkCredits`.
 */
/**
 * Quantas vezes o modelo pode pedir ferramenta antes de ser obrigado a falar.
 *
 * Cada volta é uma ida à OpenAI, cobrada do crédito da clínica. Três cobre o uso
 * real — consultar a agenda e mover o negócio na mesma conversa, com folga — e
 * fecha a porta para o laço em que o modelo chama a mesma ferramenta para sempre
 * porque não gostou da resposta.
 */
const MAX_RODADAS_DE_FERRAMENTA = 3

export async function generateReply(input: GenerateReplyInput): Promise<GeneratedReply> {
    const { agent, workspaceId, conversationId } = input

    const credits = await checkCredits(workspaceId)
    if (!credits.hasCredits) throw new OutOfCreditsError(workspaceId)

    /**
     * "Manter contexto da conversa" decide quanto do fio o modelo vê.
     *
     * Ligado (o padrão), o modelo recebe as últimas `AI_HISTORY_LIMIT` mensagens.
     * Desligado, recebe só a última do paciente — cada mensagem é respondida como
     * se fosse a primeira. O interruptor existia na tela e não era lido por
     * ninguém; agora vale, e de quebra é o jeito de uma clínica cortar custo de
     * token num atendimento que não precisa de memória.
     */
    const prefs = readPreferences(agent)

    const recent = await prisma.message.findMany({
        where: { conversationId },
        // Newest messages matter most, so take from the end and restore chronology.
        orderBy: { createdAt: 'desc' },
        take: prefs.keepContext ? env.AI_HISTORY_LIMIT : 1,
    })
    const history = recent.reverse()

    const lastInbound = [...history].reverse().find((m) => m.direction === 'inbound')

    // A busca na base e o contexto do paciente são independentes: duas idas ao
    // banco em paralelo custam o tempo da mais lenta, não a soma.
    const [knowledge, context] = await Promise.all([
        retrieveKnowledge(agent.id, lastInbound?.content ?? ''),
        loadConversationContext(conversationId, agent.timezone),
    ])

    const messages: LLMMessage[] = [
        { role: 'system', content: buildSystemPrompt(agent, knowledge, context) },
        ...toLlmHistory(history),
    ]

    const llm = LLMFactory.create(agent.llmProvider as LLMProviderName, {
        model: agent.llmModel,
        temperature: agent.temperature,
    })

    /**
     * O medidor conta **cada** ida ao modelo, não só a última.
     *
     * Uma conversa com ferramenta custa duas ou três chamadas, e cobrar só a
     * final daria à clínica um consumo que não bate com a fatura da OpenAI.
     */
    const total: LLMResponse['usage'] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const cobrar = async (usage: LLMResponse['usage'], rodada: number) => {
        total.promptTokens += usage.promptTokens
        total.completionTokens += usage.completionTokens
        total.totalTokens += usage.totalTokens
        // Contabilizar não pode engolir uma resposta pronta: se o livro-caixa
        // falhar, o paciente ainda tem que receber o que foi gerado.
        try {
            await trackUsage(agent.llmProvider as LLMProviderName, agent.llmModel, usage, {
                workspaceId,
                agentId: agent.id,
                metadata: {
                    conversationId,
                    channel: 'whatsapp',
                    knowledgeChunks: knowledge.length,
                    toolRound: rodada,
                },
            })
        } catch (error) {
            log.error(`usage tracking failed for workspace ${workspaceId}`, error)
        }
    }

    /**
     * Sem paciente resolvido, nenhuma ferramenta tem sobre quem agir.
     *
     * Acontece quando o contexto falhou de carregar — e aí o agente responde
     * pelo que sabe, em vez de chamar ferramenta sobre ninguém.
     */
    const toolContext: AgentToolContext | null = context.contactId
        ? {
              workspaceId,
              agentId: agent.id,
              conversationId,
              contactId: context.contactId,
              timezone: agent.timezone,
          }
        : null
    const ferramentas = toolContext ? AGENT_TOOL_DEFINITIONS : undefined

    let response = await llm.generate(messages, ferramentas)
    await cobrar(response.usage, 0)

    for (
        let rodada = 1;
        toolContext && response.toolCalls?.length && rodada <= MAX_RODADAS_DE_FERRAMENTA;
        rodada++
    ) {
        // A decisão do modelo volta para o histórico antes dos resultados: sem
        // ela a API recusa as mensagens de papel `tool`, que precisam de uma
        // chamada à qual responder.
        messages.push({
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls,
        })

        for (const call of response.toolCalls) {
            const resultado = await runAgentTool(call.name, call.arguments, toolContext)
            log.info(`tool ${call.name} on conversation ${conversationId}: ${resultado.slice(0, 80)}`)
            messages.push({ role: 'tool', content: resultado, toolCallId: call.id })
        }

        /**
         * Na última rodada o modelo responde **sem** ferramenta na mão.
         *
         * É o que garante que a conversa termina em texto para o paciente. Com as
         * ferramentas ainda oferecidas, um modelo em laço pediria mais uma e o
         * paciente ficaria sem resposta nenhuma.
         */
        const ultima = rodada === MAX_RODADAS_DE_FERRAMENTA
        response = await llm.generate(messages, ultima ? undefined : ferramentas)
        await cobrar(response.usage, rodada)
    }

    log.info(
        `generated reply for conversation ${conversationId} ` +
        `(${total.totalTokens} tokens, ${knowledge.length} chunks)`
    )

    return { content: response.content, usage: total }
}
