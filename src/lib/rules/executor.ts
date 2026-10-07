import prisma from '@/lib/prisma'
import {
    ActionType,
    AgentRuleConfig,
    RuleAction,
    RuleContext,
    RuleExecutionResult,
    RuleMessageDispatcher,
} from '@/types/rules'

/**
 * Carries out a matched rule's actions against the database.
 *
 * Sending is injected (`dispatchMessage`) so this module stays usable from both
 * the Next.js runtime and the worker process without either importing the
 * other's transport.
 */
export class RuleExecutor {
    constructor(private readonly dispatchMessage?: RuleMessageDispatcher) {}

    async execute(config: AgentRuleConfig, context: RuleContext): Promise<RuleExecutionResult> {
        const result: RuleExecutionResult = {
            executed: [],
            handedToHuman: false,
            repliedWithRuleMessage: false,
        }

        if (!config.actions || config.actions.length === 0) return result

        for (const action of config.actions) {
            try {
                await this.executeAction(action, context, result)
                result.executed.push(action.type as ActionType)
            } catch (error) {
                // One failed action must not cancel the rest of the rule.
                console.error(`[RULE_EXECUTOR] Action "${action.type}" failed:`, error)
            }
        }

        return result
    }

    private async executeAction(
        action: RuleAction,
        context: RuleContext,
        result: RuleExecutionResult
    ): Promise<void> {
        switch (action.type) {
            case 'send_message':
                await this.sendMessage(action.params, context, result)
                break
            case 'notify_human':
                await this.notifyHuman(action.params, context, result)
                break
            case 'add_tag':
                await this.addTag(action.params, context)
                break
            case 'move_pipeline':
                await this.movePipeline(action.params, context)
                break
            case 'schedule_followup':
                await this.scheduleFollowup(action.params, context)
                break
            default:
                console.warn(`[RULE_EXECUTOR] Unknown action type: ${action.type}`)
        }
    }

    /** Canned reply. Suppresses the agent's own generated answer for this turn. */
    private async sendMessage(
        params: Record<string, unknown>,
        context: RuleContext,
        result: RuleExecutionResult
    ): Promise<void> {
        const content = String(params.message ?? '').trim()
        if (!content) throw new Error('send_message requires a non-empty "message" param')

        if (!this.dispatchMessage || !context.channel) {
            throw new Error('send_message needs a dispatcher and channel context')
        }

        await this.dispatchMessage({
            conversationId: context.conversationId,
            content,
            integrationId: context.channel.integrationId,
            to: context.channel.to,
        })

        result.repliedWithRuleMessage = true
    }

    /**
     * Hand the thread to a person: assign it and drop an internal note so the
     * operator sees why it arrived.
     */
    private async notifyHuman(
        params: Record<string, unknown>,
        context: RuleContext,
        result: RuleExecutionResult
    ): Promise<void> {
        const assignee = await this.resolveAssignee(params, context.workspaceId)

        await prisma.conversation.update({
            where: { id: context.conversationId },
            data: {
                assignedTo: assignee ?? null,
                status: 'active',
            },
        })

        await prisma.message.create({
            data: {
                conversationId: context.conversationId,
                direction: 'outbound',
                content: String(params.note ?? 'Atendimento transferido para um humano por regra do agente.'),
                contentType: 'text',
                sentBy: 'agent',
                isInternal: true,
                status: 'sent',
            },
        })

        // Even without an explicit assignee the agent must stop answering, or it
        // would keep replying over the operator about to pick the thread up.
        result.handedToHuman = true
    }

    /**
     * Resolve `params.userId` / `params.departmentId` to a workspace member.
     * Returns undefined to leave the thread unassigned ("em espera").
     */
    private async resolveAssignee(
        params: Record<string, unknown>,
        workspaceId: string
    ): Promise<string | undefined> {
        if (params.userId) {
            const member = await prisma.workspaceUser.findFirst({
                where: { workspaceId, userId: String(params.userId), isActive: true },
                select: { userId: true },
            })
            return member?.userId
        }

        if (params.departmentId) {
            const member = await prisma.workspaceUser.findFirst({
                where: { workspaceId, departmentId: String(params.departmentId), isActive: true },
                select: { userId: true },
                orderBy: { createdAt: 'asc' },
            })
            return member?.userId
        }

        return undefined
    }

    /** Tag the conversation and the contact, creating the tag on first use. */
    private async addTag(params: Record<string, unknown>, context: RuleContext): Promise<void> {
        const name = String(params.tagName ?? params.name ?? '').trim()
        if (!name) throw new Error('add_tag requires a "tagName" param')

        // Tag has no unique constraint on (workspaceId, name), so upsert is not
        // available; look it up first and fall back to creating it.
        let tag = await prisma.tag.findFirst({
            where: { workspaceId: context.workspaceId, name },
            select: { id: true },
        })

        if (!tag) {
            tag = await prisma.tag.create({
                data: {
                    workspaceId: context.workspaceId,
                    name,
                    color: String(params.color ?? '#6B7280'),
                },
                select: { id: true },
            })
        }

        await prisma.conversationTag.createMany({
            data: [{ conversationId: context.conversationId, tagId: tag.id }],
            skipDuplicates: true,
        })

        await prisma.contactTag.createMany({
            data: [{ contactId: context.contactId, tagId: tag.id }],
            skipDuplicates: true,
        })
    }

    /** Move the contact's open deal to another stage, by id or by stage name. */
    private async movePipeline(params: Record<string, unknown>, context: RuleContext): Promise<void> {
        const stage = await this.resolveStage(params, context.workspaceId)
        if (!stage) throw new Error('move_pipeline could not resolve the target stage')

        const deal = context.dealId
            ? await prisma.deal.findFirst({
                  where: { id: context.dealId, workspaceId: context.workspaceId },
                  select: { id: true },
              })
            : await prisma.deal.findFirst({
                  where: {
                      workspaceId: context.workspaceId,
                      contactId: context.contactId,
                      status: 'open',
                  },
                  orderBy: { createdAt: 'desc' },
                  select: { id: true },
              })

        if (!deal) {
            console.warn('[RULE_EXECUTOR] move_pipeline: no open deal for contact', context.contactId)
            return
        }

        await prisma.deal.update({
            where: { id: deal.id },
            data: { stageId: stage.id },
        })
    }

    private async resolveStage(
        params: Record<string, unknown>,
        workspaceId: string
    ): Promise<{ id: string } | null> {
        if (params.stageId) {
            return prisma.pipelineStage.findFirst({
                where: { id: String(params.stageId), workspaceId },
                select: { id: true },
            })
        }

        if (params.stageName) {
            return prisma.pipelineStage.findFirst({
                where: { workspaceId, name: String(params.stageName) },
                select: { id: true },
            })
        }

        return null
    }

    /** Create a follow-up task on the agenda, N minutes/days out. */
    private async scheduleFollowup(
        params: Record<string, unknown>,
        context: RuleContext
    ): Promise<void> {
        const delayMinutes = Number(params.delayMinutes ?? params.inMinutes ?? 24 * 60)
        if (!Number.isFinite(delayMinutes) || delayMinutes < 0) {
            throw new Error('schedule_followup requires a non-negative "delayMinutes"')
        }

        const dueAt = new Date(Date.now() + delayMinutes * 60_000)

        // dueDate is a date and startTime a "HH:mm" string, so the clock part of
        // the target instant has to be split out to survive a round trip.
        const hours = String(dueAt.getHours()).padStart(2, '0')
        const minutes = String(dueAt.getMinutes()).padStart(2, '0')

        const owner = await this.resolveAssignee(params, context.workspaceId)

        await prisma.activity.create({
            data: {
                workspaceId: context.workspaceId,
                userId: owner ?? null,
                contactId: context.contactId,
                dealId: context.dealId ?? null,
                type: 'followup',
                title: String(params.title ?? 'Follow-up automático'),
                description: params.description ? String(params.description) : null,
                dueDate: dueAt,
                startTime: `${hours}:${minutes}`,
                reminderMinutes: params.reminderMinutes != null ? Number(params.reminderMinutes) : null,
            },
        })
    }
}
