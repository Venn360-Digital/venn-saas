import prisma from '@/lib/prisma'
import {
    ActionType,
    AgentRuleConfig,
    RuleAction,
    RuleContext,
    RuleExecutionResult,
    RuleMessageDispatcher,
} from '@/types/rules'
import { DEFAULT_ENTITY_COLOR } from '@/lib/palette'
import { horaMinutoNoFuso } from '@/lib/fuso'
import { resolverResponsavel } from '@/lib/rules/atribuicao'

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
            encerrou: false,
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
            case 'close_conversation':
                await this.closeConversation(action.params, context, result)
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
     * Entrega a conversa a gente: marca a entrega, atribui quando há destino, e
     * deixa a nota que explica ao atendente por que ela chegou.
     *
     * **Dois defeitos consertados aqui, e o segundo era grave.**
     *
     * O primeiro: `assignedTo: assignee ?? null` **apagava** o responsável que já
     * existisse. Uma regra sem destino, disparada numa conversa que uma pessoa já
     * tinha assumido, tirava a conversa dela — e ninguém era avisado.
     *
     * O segundo: sem destino, a conversa ficava com `assignedTo` nulo, e
     * `isHumanHandled` lia só essa coluna. Então a regra anunciava a transferência
     * ao paciente e o agente respondia a mensagem seguinte normalmente. O
     * `result.handedToHuman` calava o agente **naquela** mensagem e só nela.
     * Agora `handoffAt` carrega a entrega adiante.
     */
    private async notifyHuman(
        params: Record<string, unknown>,
        context: RuleContext,
        result: RuleExecutionResult
    ): Promise<void> {
        const assignee = await resolverResponsavel({
            workspaceId: context.workspaceId,
            userId: params.userId ? String(params.userId) : null,
            departmentId: params.departmentId ? String(params.departmentId) : null,
        })

        await prisma.conversation.update({
            where: { id: context.conversationId },
            data: {
                status: 'active',
                handoffAt: new Date(),
                handoffReason: 'regra',
                // Só escreve quando resolveu alguém: sem destino, quem já atende
                // continua atendendo.
                ...(assignee ? { assignedTo: assignee } : {}),
            },
        })

        await prisma.message.create({
            data: {
                conversationId: context.conversationId,
                /**
                 * `internal`, e não `outbound`.
                 *
                 * A nota já vinha com `isInternal: true` e nunca saiu para o
                 * paciente, mas a direção dizia o contrário — e é por direção que
                 * os relatórios contam mensagem enviada. Cada regra de
                 * transferência inflava o volume de saída da clínica com uma
                 * mensagem que ninguém mandou.
                 */
                direction: 'internal',
                content: String(params.note ?? 'Atendimento transferido para um humano por regra do agente.'),
                contentType: 'text',
                sentBy: 'agent',
                isInternal: true,
                status: 'sent',
            },
        })

        result.handedToHuman = true
    }

    /**
     * Encerra o atendimento — e com ele a vez do agente nesta mensagem.
     *
     * Existe para o caso que nenhuma outra ação cobria: a mensagem que **não
     * precisa de atendimento**. "obrigado", "era só isso", o descadastro que já
     * foi tratado — hoje cada uma delas ou consome uma resposta do agente ou
     * fica aberta até o cron de `autoCloseDays` varrer, trinta dias depois.
     *
     * Três coisas acontecem juntas, e nenhuma é opcional:
     *
     *   - `status` e `closedAt`, que é o que a caixa de entrada lê para mostrar
     *     "Finalizada". **`closedAt` também reinicia a contagem do limite de
     *     interações** (ver `desdeQuandoContar`), e isso é desejável: atendimento
     *     encerrado e reaberto é atendimento novo.
     *   - a nota interna, porque conversa que fecha sozinha sem rastro é a
     *     clínica descobrindo pelo paciente reclamando.
     *   - `result.encerrou`, que impede o agente de responder a seguir. Sem ele,
     *     a regra fecharia e o agente escreveria logo depois — e a mensagem dele
     *     reabriria a leitura do fio na tela, com o rótulo mentindo.
     *
     * **Não desatribui ninguém.** Se um atendente estava com a conversa, ela
     * fecha atribuída a ele, que é quem a conduziu. Quem decide o contrário é
     * `notify_human`, na direção oposta.
     */
    private async closeConversation(
        params: Record<string, unknown>,
        context: RuleContext,
        result: RuleExecutionResult
    ): Promise<void> {
        await prisma.conversation.update({
            where: { id: context.conversationId },
            data: { status: 'closed', closedAt: new Date() },
        })

        await prisma.message.create({
            data: {
                conversationId: context.conversationId,
                direction: 'internal',
                content: String(params.note ?? 'Atendimento encerrado por regra do agente.'),
                contentType: 'text',
                sentBy: 'agent',
                isInternal: true,
                status: 'sent',
            },
        })

        result.encerrou = true
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
                    color: String(params.color ?? DEFAULT_ENTITY_COLOR),
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
        // A hora que vai para `startTime` é de parede, da clínica: no Worker
        // `getHours()` gravaria a hora UTC — 14h viraria "17:00" no banco.
        const [hours, minutes] = horaMinutoNoFuso(dueAt).split(':')

        const owner = await resolverResponsavel({
            workspaceId: context.workspaceId,
            userId: params.userId ? String(params.userId) : null,
            departmentId: params.departmentId ? String(params.departmentId) : null,
        })

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
