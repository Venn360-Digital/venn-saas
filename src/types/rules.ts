/**
 * `user_intent` e `custom` seguem no tipo e **não são mais aceitos pela API**.
 *
 * Os dois nunca disparam: `user_intent` exige uma classificação que nenhum
 * caminho do sistema produz, e `custom` é `return false` literal. Ficam aqui
 * porque regra antiga gravada com eles existe no banco, e a tela precisa saber
 * nomeá-los para avisar. Regra nova com eles é recusada na gravação.
 */
export type ConditionType =
    | 'message_contains'
    | 'time_elapsed'
    | 'first_message'
    | 'business_hours'
    | 'user_intent'
    | 'custom'

/**
 * `inside`/`outside` existem para a janela de expediente.
 *
 * O resto do vocabulário é de comparação (`contains`, `greater_than`); estes dois
 * são de pertencimento, e nomeá-los assim evita a gambiarra de "equals false".
 */
export type Operator =
    | 'equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'starts_with'
    | 'inside'
    | 'outside'

export type ActionType =
    | 'send_message'
    | 'notify_human'
    | 'add_tag'
    | 'move_pipeline'
    | 'schedule_followup'
    | 'close_conversation'

export interface RuleCondition {
    type: ConditionType
    operator: Operator
    value: unknown
}

export interface RuleAction {
    type: ActionType
    params: Record<string, unknown>
}

export interface AgentRuleConfig {
    conditions: RuleCondition[]
    actions: RuleAction[]
}

// Zod Schema for validation
import { z } from 'zod'

/**
 * O que a **gravação** aceita — e `user_intent`/`custom` ficaram fora.
 *
 * Eles nunca disparam, e deixar a API aceitá-los é deixar criar regra que não
 * funciona. Regra antiga com eles continua lendo e sendo avaliada (como falsa),
 * porque `conditions` é JSON e nada reescreve o que já está gravado; o que não
 * dá mais é nascer uma nova.
 */
export const conditionSchema = z.object({
    type: z.enum(['message_contains', 'time_elapsed', 'first_message', 'business_hours']),
    operator: z.enum([
        'equals',
        'contains',
        'greater_than',
        'less_than',
        'starts_with',
        'inside',
        'outside',
    ]),
    value: z.unknown(),
})

export const actionSchema = z.object({
    type: z.enum([
        'send_message',
        'notify_human',
        'add_tag',
        'move_pipeline',
        'schedule_followup',
        'close_conversation',
    ]),
    params: z.record(z.string(), z.unknown()),
})

export const ruleConfigSchema = z.object({
    conditions: z.array(conditionSchema),
    actions: z.array(actionSchema),
})

// ---------------------------------------------------------------------------
// Runtime context
// ---------------------------------------------------------------------------

/**
 * Everything a rule may inspect or act upon for one inbound message.
 *
 * Built by the caller (today: the whatsapp-inbound worker) so the engine itself
 * stays free of channel-specific lookups.
 */
export interface RuleContext {
    workspaceId: string
    agentId: string
    conversationId: string
    contactId: string
    /** Open deal for this contact, when there is one. */
    dealId?: string | null

    /** Text of the message that triggered the evaluation. */
    message: string
    /** Classified intent, when an upstream step produced one. */
    intent?: string

    /** Minutes since the previous message in the thread; drives `time_elapsed`. */
    minutesSinceLastMessage?: number

    /**
     * Esta é a primeira mensagem da conversa? Alimenta `first_message`.
     *
     * Vem de quem monta o contexto, que já consultou a mensagem anterior para
     * calcular `minutesSinceLastMessage` — e é a mesma consulta que decide se a
     * saudação sai. Sem este campo, a condição "primeira mensagem" teria de ser
     * escrita como `time_elapsed`, que é **falso** na primeira mensagem justamente
     * por não haver mensagem anterior.
     */
    isFirstMessage?: boolean

    /**
     * O instante da avaliação. Alimenta `business_hours`.
     *
     * Chega como `Date` e a conversão para hora de parede acontece no avaliador,
     * com os helpers de `lib/fuso` — então o teste fixa um instante e a lógica de
     * fuso continua num lugar só.
     */
    agora?: Date

    /**
     * O fuso da unidade — o relógio em que `agora` vira hora de parede.
     *
     * Vem de quem monta o contexto, que já sabe de que unidade se trata, e não
     * é descoberto dentro do avaliador: o avaliador é função pura e testável
     * por desenho, e consultar o banco lá dentro tiraria isso dele.
     *
     * Ausente cai no padrão do sistema, que é o comportamento de antes desta
     * coluna existir — e é o que acontece no teste, que fixa o instante.
     */
    fuso?: string

    /**
     * Channel coordinates, needed by `send_message`. Addresses the integration
     * rather than a provider instance, so a rule's reply resolves the provider the
     * same way the agent's own replies do.
     */
    channel?: {
        integrationId: string
        to: string
    }
}

/** Hook the executor uses to hand an outbound message to the queue. */
export type RuleMessageDispatcher = (input: {
    conversationId: string
    content: string
    integrationId: string
    to: string
}) => Promise<void>

export interface RuleExecutionResult {
    executed: ActionType[]
    /** Set when an action takes the conversation away from the agent. */
    handedToHuman: boolean
    /** Set when a rule already answered, so the agent should not also reply. */
    repliedWithRuleMessage: boolean
    /**
     * Set when a rule closed the thread. O agente não responde a um atendimento
     * que a regra acabou de encerrar — seria reabrir pela porta de trás.
     */
    encerrou: boolean
}
