import { AgentRuleConfig, RuleCondition, ConditionType, Operator } from '@/types/rules'

export class RuleEvaluator {
    /**
     * Evaluates if a rule should be triggered based on context.
     * Currently supports 'AND' logic (all conditions must be true).
     */
    async evaluate(config: AgentRuleConfig, context: any): Promise<boolean> {
        if (!config.conditions || config.conditions.length === 0) return true

        for (const condition of config.conditions) {
            const isMet = await this.evaluateCondition(condition, context)
            if (!isMet) return false
        }

        return true
    }

    private async evaluateCondition(condition: RuleCondition, context: any): Promise<boolean> {
        const { type, operator, value } = condition

        switch (type) {
            case 'message_contains':
                return this.evaluateMessageContains(context.message, value, operator)
            case 'user_intent':
                // Placeholder: Needs LLM classification result in context
                return context.intent === value
            case 'custom':
                // Placeholder for custom logic
                return false
            default:
                return false
        }
    }

    private evaluateMessageContains(message: string, value: string | string[], operator: Operator): boolean {
        if (!message) return false
        const content = message.toLowerCase()
        const targetValues = Array.isArray(value) ? value : [value]

        return targetValues.some(target => {
            const t = String(target).toLowerCase()
            switch (operator) {
                case 'contains':
                    return content.includes(t)
                case 'equals':
                    return content === t
                case 'starts_with':
                    return content.startsWith(t)
                default:
                    return false
            }
        })
    }
}
