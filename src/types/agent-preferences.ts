import { z } from 'zod'

/**
 * As preferências de conversa do agente — uma definição só, para a tela, para a
 * API e para o worker.
 *
 * Existiam quatro cópias desta forma: o tipo do formulário em
 * `types/agent-creation.ts`, a interface local do `PreferenciasTab`, os defaults
 * do `useAgentCommands` e a interface do worker em `services/prompt.ts`. Nenhuma
 * delas se olhava, e foi assim que `responseSpeed` virou duas coisas
 * incompatíveis: a tela gravava um número de segundos e o worker esperava
 * `'instant' | 'fast' | 'natural' | 'slow'`, então o valor da tela nunca casava e
 * o atraso era sempre zero. O slider existia e não movia nada.
 *
 * O campo é um número de segundos agora, que é o que a tela sempre mostrou.
 */

/** Teto do atraso extra, igual ao `max` do slider. */
const MAX_RESPONSE_DELAY_SECONDS = 10

/** Quantas interações o agente aceita por atendimento, conforme a tela oferece. */
export const INTERACTION_LIMITS = [12, 25, 50, 100] as const

/**
 * Os nomes antigos do `responseSpeed`, para o caso de um agente ter sido gravado
 * com eles. Nenhuma rota chegou a gravar `preferences` — o campo era descartado
 * pelo zod antes de chegar ao banco — mas a rota de duplicação copiava o JSON
 * cru, então um valor herdado não é impossível.
 */
const LEGACY_SPEED_SECONDS: Record<string, number> = {
    instant: 0,
    fast: 1,
    natural: 3,
    slow: 8,
}

const responseSpeedSchema = z.preprocess((value) => {
    if (typeof value === 'string') return LEGACY_SPEED_SECONDS[value] ?? undefined
    return value
}, z.number().min(0).max(MAX_RESPONSE_DELAY_SECONDS))

export const agentPreferencesSchema = z.object({
    /** Envia "digitando…" ao canal enquanto o modelo trabalha. */
    showTypingIndicator: z.boolean(),
    /** Atraso extra, em segundos, somado ao debounce de entrada. */
    responseSpeed: responseSpeedSchema,
    /** Quando falso, o modelo responde só à última mensagem, sem histórico. */
    keepContext: z.boolean(),
    useEmojis: z.boolean(),
    /** Recusa assunto fora da empresa e das atribuições do agente. */
    restrictTopics: z.boolean(),
    /**
     * Respostas do agente por atendimento; ao estourar, a conversa vai para a
     * equipe. Zero significa sem limite — valor que a tela não oferece, e que
     * existe para o agente que nunca configurou preferência nenhuma.
     */
    interactionLimit: z.number().int().min(0).max(1000),
})

export type AgentPreferences = z.infer<typeof agentPreferencesSchema>

/**
 * O que um agente **novo** recebe gravado ao ser criado.
 *
 * `keepContext` nasce ligado porque um agente sem histórico responde cada
 * mensagem como se fosse a primeira.
 *
 * O limite de interações é a trava que impede um fio em loop de queimar crédito
 * indefinidamente, e nasce em **12** desde 2026-10-15. Era 50, por duas razões
 * que não se sustentaram quando as contas foram feitas:
 *
 * - **Produto:** uma conversa que precisou de cinquenta respostas do robô já
 *   fracassou. Devia ter ido para uma pessoa muito antes, e o limite é o único
 *   mecanismo que faz isso acontecer.
 * - **Custo:** a cinquenta respostas por atendimento, a franquia de qualquer
 *   plano consome 40% da mensalidade — contra os 10% que são o alvo. A doze,
 *   os três planos ficam dentro do alvo mesmo se a conversa média for quatro
 *   vezes maior do que a estimativa.
 */
export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
    showTypingIndicator: true,
    /** Cinco segundos: tempo de alguém lendo e digitando, não de um robô. */
    responseSpeed: 5,
    keepContext: true,
    useEmojis: true,
    /** Clínica responde de clínica: fora disso, recusa educadamente. */
    restrictTopics: true,
    interactionLimit: 12,
}

/**
 * O que um agente **já existente**, com a coluna `preferences` nula, se comporta
 * como: exatamente o que o código fazia antes destas preferências passarem a ser
 * lidas.
 *
 * Existe para que ligar o interruptor não mude, sozinho, o comportamento de um
 * agente que já está atendendo. Até a Fase 1, nenhuma rota conseguia gravar
 * `preferences` — o campo era descartado pela validação —, então *todo* agente
 * em produção tem a coluna nula. Se o fallback fosse o conjunto acima, o deploy
 * ligaria "digitando" em agentes no ar, acrescentaria "Não utilize emojis" ao
 * prompt deles e passaria a encerrar na quinquagésima resposta a conversa de um
 * paciente antigo — que acumula respostas na mesma linha, porque a conversa é
 * reaberta em vez de recriada.
 *
 * A clínica passa a valer o conjunto de cima no momento em que abre a aba
 * Preferências e salva, que é quando a escolha é dela.
 */
export const UNCONFIGURED_AGENT_PREFERENCES: AgentPreferences = {
    showTypingIndicator: false,
    responseSpeed: 0,
    keepContext: true,
    useEmojis: false,
    restrictTopics: false,
    /** Sem limite, como antes. */
    interactionLimit: 0,
}

/** Se a clínica chegou a gravar preferência alguma para este agente. */
export function hasStoredPreferences(raw: unknown): boolean {
    return !!raw && typeof raw === 'object' && Object.keys(raw as object).length > 0
}

/** O que a API aceita num PATCH: qualquer subconjunto dos campos. */
export const agentPreferencesPatchSchema = agentPreferencesSchema.partial()

/**
 * Lê as preferências de um agente, preenchendo o que falta com os defaults.
 *
 * Tolerante por contrato: a coluna é `Json?` e pode conter o que uma versão
 * anterior gravou. Um campo inválido cai no default em vez de derrubar a
 * resposta ao paciente.
 */
export function readAgentPreferences(raw: unknown): AgentPreferences {
    if (!hasStoredPreferences(raw)) return UNCONFIGURED_AGENT_PREFERENCES

    // A base é o conjunto do agente não configurado, não o do agente novo: um
    // campo que a clínica nunca escolheu continua valendo o comportamento
    // anterior, mesmo que os vizinhos dele no JSON já tenham sido escolhidos.
    const result = { ...UNCONFIGURED_AGENT_PREFERENCES }
    const source = raw as Record<string, unknown>

    for (const key of Object.keys(agentPreferencesSchema.shape) as (keyof AgentPreferences)[]) {
        if (!(key in source)) continue
        const parsed = agentPreferencesSchema.shape[key].safeParse(source[key])
        if (parsed.success) {
            // O índice é a mesma chave dos dois lados; o TS não consegue
            // acompanhar a correlação num laço, e um objeto intermediário só
            // trocaria esta linha por uma asserção igual.
            ;(result as Record<string, unknown>)[key] = parsed.data
        }
    }

    return result
}
