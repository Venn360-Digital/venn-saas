import type { Agent } from '@prisma/client'
import type { ConversationContext } from './conversation-context'
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
/**
 * A postura que cada função implica.
 *
 * `agentFunction` era gravado pela tela e lido por ninguém: o seletor
 * SDR/Vendas/Suporte não mudava uma vírgula da resposta. Aqui ele vira o que a
 * clínica espera que fosse — a diferença entre um agente que qualifica e agenda
 * e um que resolve e não empurra venda.
 */
const POSTURA: Record<string, string> = {
    sdr_atendimento:
        'Seu objetivo é entender o que a pessoa precisa e levá-la a agendar uma avaliação. ' +
        'Faça uma pergunta de cada vez, confirme o que entendeu e proponha horário quando fizer sentido.',
    vendas:
        'Seu objetivo é esclarecer dúvidas sobre tratamentos, valores e formas de pagamento, e fechar o agendamento. ' +
        'Seja direto sobre preço quando souber a informação, e nunca invente valor que não esteja na sua base.',
    suporte:
        'Seu objetivo é resolver a dúvida ou o problema de quem já é paciente. ' +
        'Não force venda: se a pessoa só precisa de uma informação, entregue a informação.',
}

/**
 * O rótulo legível de cada tom e idioma.
 *
 * Os seletores gravam o valor cru — `amigavel`, `pt-BR` — e ele ia direto para
 * dentro do prompt: "Tom de voz: amigavel. Responda sempre em pt-BR." O modelo
 * entende assim mesmo, mas é texto que ele lê, e vale escrever em português de
 * gente. Valor fora da lista passa como está, em vez de sumir.
 */
const TOM: Record<string, string> = {
    pratico: 'prático e objetivo',
    formal: 'formal e respeitoso',
    casual: 'casual e leve',
    amigavel: 'amigável e acolhedor',
    entusiasmado: 'entusiasmado',
}

const IDIOMA: Record<string, string> = {
    'pt-BR': 'português do Brasil',
    'en-US': 'inglês',
    'es-ES': 'espanhol',
    'fr-FR': 'francês',
}

export function buildSystemPrompt(
    agent: Agent,
    knowledge: KnowledgeChunk[] = [],
    context?: ConversationContext
): string {
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

    const atribuicoes = [
        agent.agentFunction && POSTURA[agent.agentFunction],
        agent.jobDescription,
    ].filter(Boolean)

    if (atribuicoes.length > 0) {
        sections.push(`## Suas funções e atribuições\n${atribuicoes.join('\n\n')}`)
    }

    const style: string[] = []
    if (agent.voiceTone) style.push(`Mantenha um tom ${TOM[agent.voiceTone] ?? agent.voiceTone}.`)
    if (agent.language) style.push(`Responda sempre em ${IDIOMA[agent.language] ?? agent.language}.`)

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

    /**
     * O que o agente sabe sobre agora e sobre quem está do outro lado.
     *
     * A data é o item mais importante desta seção: um agente que agenda e não
     * sabe que dia é hoje não consegue interpretar "pode ser amanhã?" nem
     * perceber que a consulta de sexta já passou. O resto evita o vexame de
     * perguntar o nome de quem a clínica já atende, ou oferecer horário a quem
     * já tem consulta marcada.
     */
    if (context) {
        const linhas: string[] = [`Agora é ${context.agora} (horário de Brasília).`]

        if (context.contactFirstName) {
            linhas.push(
                `Você está falando com ${context.contactFullName}. ` +
                `Trate a pessoa por ${context.contactFirstName}, e não pergunte o nome dela de novo.`
            )
        } else {
            linhas.push('Você ainda não sabe o nome desta pessoa; pergunte com naturalidade na primeira oportunidade.')
        }

        if (context.dealStage) {
            linhas.push(`No funil da clínica, este atendimento está na fase "${context.dealStage}".`)
        }

        if (context.upcoming.length > 0) {
            const lista = context.upcoming.map((c) => `- ${c.quando}: ${c.titulo}`).join('\n')
            linhas.push(`Compromissos já marcados para esta pessoa:\n${lista}`)
            linhas.push('Não ofereça novo agendamento sem antes considerar o que já está marcado.')
        }

        sections.push(`## Esta conversa\n${linhas.join('\n')}`)
    }

    // WhatsApp-specific shaping: long markdown answers read badly in a chat bubble.
    sections.push(
        '## Formato\n' +
        'Você está conversando pelo WhatsApp. Escreva mensagens curtas e diretas, ' +
        'sem markdown, sem títulos e sem listas numeradas longas.'
    )

    return sections.join('\n\n')
}
