import type { Agent } from '@prisma/client'
import prisma from '@/lib/prisma'
import { RuleEvaluator } from '@/lib/rules/evaluator'
import { RuleExecutor } from '@/lib/rules/executor'
import { ruleConfigSchema, type RuleContext, type RuleExecutionResult } from '@/types/rules'
import { createLogger } from '@/trabalhos/registro'
import { enqueueOutboundText } from './outbound'

const log = createLogger('RULES')

const evaluator = new RuleEvaluator()
/**
 * The executor is channel-agnostic, so the dispatcher it receives is what knows
 * how to put a message on the wire. `agentId` is intentionally absent: the rule's
 * own agent is not threaded through the executor's dispatch signature, and
 * message.sent for rule replies is covered by the message row itself.
 */
const executor = new RuleExecutor(async ({ conversationId, content, integrationId, to }) => {
    await enqueueOutboundText({ conversationId, content, integrationId, to, sentBy: 'agent' })
})

const EMPTY: RuleExecutionResult = {
    executed: [],
    handedToHuman: false,
    repliedWithRuleMessage: false,
}

/**
 * Run the agent's active rules against an inbound message.
 *
 * Rules are evaluated in priority order and every match is executed, but the
 * first rule that answers or escalates decides whether the LLM still runs — see
 * the merged flags in the returned result.
 */
export async function applyAgentRules(
    agent: Agent,
    context: RuleContext
): Promise<RuleExecutionResult> {
    const rules = await prisma.agentRule.findMany({
        where: { agentId: agent.id, isActive: true },
        orderBy: { priority: 'desc' },
    })

    if (rules.length === 0) return EMPTY

    const merged: RuleExecutionResult = { ...EMPTY, executed: [] }

    for (const rule of rules) {
        const parsed = ruleConfigSchema.safeParse({
            conditions: rule.conditions,
            actions: rule.actions,
        })

        if (!parsed.success) {
            log.warn(`rule ${rule.id} ("${rule.name}") has an invalid config; skipping`)
            continue
        }

        if (!evaluator.evaluate(parsed.data, context)) continue

        log.info(`rule matched: ${rule.name} (${rule.id})`)
        const result = await executor.execute(parsed.data, context)

        merged.executed.push(...result.executed)
        merged.handedToHuman = merged.handedToHuman || result.handedToHuman
        merged.repliedWithRuleMessage =
            merged.repliedWithRuleMessage || result.repliedWithRuleMessage
    }

    return merged
}
