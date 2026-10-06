export type ConditionType = 'message_contains' | 'user_intent' | 'time_elapsed' | 'custom'
export type Operator = 'equals' | 'contains' | 'greater_than' | 'less_than' | 'starts_with'
export type ActionType = 'send_message' | 'notify_human' | 'add_tag' | 'move_pipeline' | 'schedule_followup'

export interface RuleCondition {
    type: ConditionType
    operator: Operator
    value: any
}

export interface RuleAction {
    type: ActionType
    params: Record<string, any>
}

export interface AgentRuleConfig {
    conditions: RuleCondition[]
    actions: RuleAction[]
}

// Zod Schema for validation
import { z } from 'zod'

export const conditionSchema = z.object({
    type: z.enum(['message_contains', 'user_intent', 'time_elapsed', 'custom']),
    operator: z.enum(['equals', 'contains', 'greater_than', 'less_than', 'starts_with']),
    value: z.any(),
})

export const actionSchema = z.object({
    type: z.enum(['send_message', 'notify_human', 'add_tag', 'move_pipeline', 'schedule_followup']),
    params: z.record(z.string(), z.any()),
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
}
