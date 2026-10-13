import type { Agent, Message } from '@prisma/client'
import prisma from '@/lib/prisma'
import { LLMFactory } from '@/lib/llm/factory'
import { checkCredits, trackUsage } from '@/lib/llm/usage-tracker'
import type { LLMMessage, LLMProviderName, LLMResponse } from '@/types/llm'
import { DocumentRetriever } from '@/lib/rag/retriever'
import { env } from '../env'
import { createLogger } from '../logger'
import { buildSystemPrompt, readPreferences, type KnowledgeChunk } from './prompt'

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
    const knowledge = await retrieveKnowledge(agent.id, lastInbound?.content ?? '')

    const messages: LLMMessage[] = [
        { role: 'system', content: buildSystemPrompt(agent, knowledge) },
        ...toLlmHistory(history),
    ]

    const llm = LLMFactory.create(agent.llmProvider as LLMProviderName, {
        model: agent.llmModel,
        temperature: agent.temperature,
    })

    const response = await llm.generate(messages)

    // Usage accounting must not swallow a successful generation: if the ledger
    // write fails we still want the customer to get their answer.
    try {
        await trackUsage(agent.llmProvider as LLMProviderName, agent.llmModel, response.usage, {
            workspaceId,
            agentId: agent.id,
            metadata: {
                conversationId,
                channel: 'whatsapp',
                knowledgeChunks: knowledge.length,
            },
        })
    } catch (error) {
        log.error(`usage tracking failed for workspace ${workspaceId}`, error)
    }

    log.info(
        `generated reply for conversation ${conversationId} ` +
        `(${response.usage.totalTokens} tokens, ${knowledge.length} chunks)`
    )

    return { content: response.content, usage: response.usage }
}
