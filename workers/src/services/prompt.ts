import type { Agent } from '@prisma/client'
import {
    type AgentPreferences,
    hasStoredPreferences,
    readAgentPreferences,
} from '@/types/agent-preferences'

export interface KnowledgeChunk {
    title: string
    content: string
    similarity?: number
}

/**
 * As preferências do agente, com os defaults preenchidos.
 *
 * A forma vive em `@/types/agent-preferences`, junto com a tela e a API. A
 * interface local que existia aqui declarava `responseSpeed` como um enum de
 * texto enquanto a tela gravava segundos — e como ninguém comparava as duas, o
 * slider nunca teve efeito.
 */
export function readPreferences(agent: Agent): AgentPreferences {
    return readAgentPreferences(agent.preferences)
}

/**
 * Assemble the system prompt from the agent's configured persona plus any
 * retrieved knowledge.
 *
 * The old inline handler sent `agent.systemPrompt` alone, so everything the user
 * filled in on the Perfil/Trabalho/Preferências tabs — company name, job
 * description, tone, language — never reached the model, and the knowledge base
 * was written but never read.
 */
export function buildSystemPrompt(agent: Agent, knowledge: KnowledgeChunk[] = []): string {
    const sections: string[] = [agent.systemPrompt.trim()]

    const company = [
        agent.companyName && `Nome: ${agent.companyName}`,
        agent.companySector && `Setor: ${agent.companySector}`,
        // O endereço da unidade deste agente. "Onde vocês ficam?" é das
        // perguntas mais frequentes numa clínica, e até aqui só tinha resposta
        // se alguém a tivesse escrito dentro das atribuições ou de uma FAQ.
        agent.companyAddress && `Endereço: ${agent.companyAddress}`,
        agent.companyWebsite && `Site: ${agent.companyWebsite}`,
        agent.companyDescription && `Sobre: ${agent.companyDescription}`,
    ].filter(Boolean)

    if (company.length > 0) {
        sections.push(`## Empresa\n${company.join('\n')}`)
    }

    if (agent.jobDescription) {
        sections.push(`## Suas funções e atribuições\n${agent.jobDescription}`)
    }

    const style: string[] = []
    if (agent.voiceTone) style.push(`Tom de voz: ${agent.voiceTone}.`)
    if (agent.language) style.push(`Responda sempre em ${agent.language}.`)

    const prefs = readPreferences(agent)

    /**
     * A instrução sobre emoji só existe quando a clínica escolheu.
     *
     * Antes das preferências passarem a ser gravadas, `useEmojis` era sempre
     * indefinido e nenhuma das duas linhas entrava: o modelo decidia sozinho.
     * Sem esta guarda, o agente que já atende passaria a receber "Não utilize
     * emojis" por causa de um default nosso — mudança de tom que ninguém pediu.
     */
    if (hasStoredPreferences(agent.preferences)) {
        style.push(prefs.useEmojis ? 'Use emojis com moderação.' : 'Não utilize emojis.')
    }
    if (prefs.restrictTopics) {
        style.push(
            'Responda somente sobre assuntos relacionados à empresa e às suas atribuições. ' +
            'Para qualquer outro tema, recuse educadamente e retome o atendimento.'
        )
    }

    if (style.length > 0) {
        sections.push(`## Estilo de comunicação\n${style.join(' ')}`)
    }

    if (knowledge.length > 0) {
        const corpus = knowledge
            .map((chunk, i) => `[${i + 1}] ${chunk.title}\n${chunk.content}`)
            .join('\n\n')
        sections.push(
            '## Base de conhecimento\n' +
            'Use os trechos abaixo como fonte de verdade. Se a resposta não estiver ' +
            'neles, diga que vai verificar em vez de inventar.\n\n' +
            corpus
        )
    }

    // WhatsApp-specific shaping: long markdown answers read badly in a chat bubble.
    sections.push(
        '## Formato\n' +
        'Você está conversando pelo WhatsApp. Escreva mensagens curtas e diretas, ' +
        'sem markdown, sem títulos e sem listas numeradas longas.'
    )

    return sections.join('\n\n')
}
