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
export const INTERACTION_LIMITS = [10, 25, 50, 100] as const

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
    /** Respostas do agente por atendimento; ao estourar, a conversa vai para a equipe. */
    interactionLimit: z.number().int().min(1).max(1000),
})

export type AgentPreferences = z.infer<typeof agentPreferencesSchema>

/**
 * O que um agente sem preferências gravadas se comporta como.
 *
 * `keepContext` nasce ligado porque um agente sem histórico responde cada
 * mensagem como se fosse a primeira — é o comportamento que o worker sempre
 * teve, e desligá-lo por omissão seria uma regressão silenciosa.
 */
export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
    showTypingIndicator: true,
    responseSpeed: 0,
    keepContext: true,
    useEmojis: false,
    restrictTopics: false,
    interactionLimit: 50,
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
    if (!raw || typeof raw !== 'object') return DEFAULT_AGENT_PREFERENCES

    const result = { ...DEFAULT_AGENT_PREFERENCES }
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
