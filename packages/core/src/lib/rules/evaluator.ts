import { AgentRuleConfig, RuleCondition, Operator, RuleContext } from '@/types/rules'
import { diaDaSemanaNoFuso, horaMinutoNoFuso } from '../fuso'
import { dentroDaJanela, normalizarJanela } from './expediente'

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

            case 'first_message':
                return this.matchFirstMessage(context.isFirstMessage, condition.value)

            case 'business_hours':
                return this.matchBusinessHours(
                    context.agora,
                    condition.value,
                    condition.operator,
                    context.fuso
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

    /**
     * "É a primeira mensagem" — e o valor diz se a regra quer o sim ou o não.
     *
     * Sem o campo no contexto a regra **não dispara**: quem monta o contexto é
     * que sabe se há mensagem anterior, e adivinhar aqui faria toda regra de
     * primeira mensagem valer em canal que não informa isso.
     *
     * Aceita `true`, `'true'` e `'sim'` porque o valor atravessa JSON e já
     * chegou como texto de versões anteriores da tela.
     */
    private matchFirstMessage(isFirstMessage: boolean | undefined, value: unknown): boolean {
        if (isFirstMessage === undefined) return false

        const bruto = String(value).trim().toLowerCase()
        const querPrimeira = bruto === 'true' || bruto === 'sim' || bruto === '1'

        return isFirstMessage === querPrimeira
    }

    /**
     * Dentro ou fora da janela de expediente declarada na própria condição.
     *
     * **Janela malformada não dispara**, nos dois operadores. Parece assimétrico
     * — "fora do expediente" com janela inválida poderia valer sempre —, e é
     * justamente o que não se quer: a regra inválida mais perigosa é a que
     * responde "estamos fechados" vinte e quatro horas por dia. Ver
     * `normalizarJanela`.
     *
     * A hora de parede sai de `lib/fuso`, no fuso **da unidade**: o Worker roda
     * em UTC, então comparar `Date` cru erraria em três horas — e usar o fuso do
     * sistema erraria o expediente inteiro de quem não opera no Brasil.
     */
    private matchBusinessHours(
        agora: Date | undefined,
        value: unknown,
        operator: Operator,
        fuso?: string
    ): boolean {
        if (!agora) return false

        const janela = normalizarJanela(value)
        if (!janela) return false

        const dentro = dentroDaJanela(
            horaMinutoNoFuso(agora, fuso),
            diaDaSemanaNoFuso(agora, fuso),
            janela
        )

        switch (operator) {
            case 'inside':
                return dentro
            case 'outside':
                return !dentro
            default:
                return false
        }
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
