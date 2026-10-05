import { AgentRuleConfig, RuleCondition, Operator, RuleContext } from '@/types/rules'

/**
 * Decides whether a rule's conditions are satisfied for a given message.
 *
 * All conditions must hold (AND). OR semantics would need a nested group shape
 * in `AgentRule.conditions`, which the editor does not produce yet.
 */
export class RuleEvaluator {
    evaluate(config: AgentRuleConfig, context: RuleContext): boolean {
        if (!config.conditions || config.conditions.length === 0) return true
        return config.conditions.every((condition) => this.evaluateCondition(condition, context))
    }

    private evaluateCondition(condition: RuleCondition, context: RuleContext): boolean {
        switch (condition.type) {
            case 'message_contains':
                return this.matchText(context.message, condition.value, condition.operator)

            case 'user_intent':
                // Requires an upstream classification step. Without one the rule
                // must not fire, or every intent rule would match blindly.
                if (!context.intent) return false
                return this.matchText(context.intent, condition.value, condition.operator)

            case 'time_elapsed':
                return this.matchElapsed(
                    context.minutesSinceLastMessage,
                    condition.value,
                    condition.operator
                )

            case 'custom':
                // No extension point wired yet; never auto-fire.
                return false

            default:
                return false
        }
    }

    /** Case-insensitive text match; `value` may be a single string or a list (any-of). */
    private matchText(subject: string | undefined, value: unknown, operator: Operator): boolean {
        if (!subject) return false

        const haystack = subject.toLowerCase()
        const needles = (Array.isArray(value) ? value : [value])
            .filter((v) => v !== null && v !== undefined)
            .map((v) => String(v).toLowerCase().trim())
            .filter((v) => v.length > 0)

        if (needles.length === 0) return false

        return needles.some((needle) => {
            switch (operator) {
                case 'contains':
                    return haystack.includes(needle)
                case 'equals':
                    return haystack === needle
                case 'starts_with':
                    return haystack.startsWith(needle)
                default:
                    return false
            }
        })
    }

    private matchElapsed(
        elapsedMinutes: number | undefined,
        value: unknown,
        operator: Operator
    ): boolean {
        if (elapsedMinutes === undefined) return false

        const threshold = Number(value)
        if (!Number.isFinite(threshold)) return false

        switch (operator) {
            case 'greater_than':
                return elapsedMinutes > threshold
            case 'less_than':
                return elapsedMinutes < threshold
            case 'equals':
                return Math.round(elapsedMinutes) === Math.round(threshold)
            default:
                return false
        }
    }
}
