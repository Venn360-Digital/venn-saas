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
