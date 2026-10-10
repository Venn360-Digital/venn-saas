import { getBillingState } from '@/lib/billing'
import { claimAutoNotice } from '@/lib/auto-notice'
import { enqueueOutboundText } from '../services/outbound'
import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import { decodeMessage, toMsisdn } from '@/lib/whatsapp'
import type { RuleContext } from '@/types/rules'
import { env } from '../env'
import { createLogger } from '../logger'
import type { WhatsAppInboundJob } from '../queues'
import { archiveInboundMedia } from '../services/media'
import { delayForSpeed, scheduleAiReply } from '../services/ai-reply-schedule'
import { transcribeAudio } from '../services/transcribe'
import { isHumanHandled, resolveInboundContext } from '../services/conversation'
import { isOptOut } from './cron/auto-follow-up'
import { findIntegrationByRef, providerFor, touchIntegration } from '../services/integration'
import { readPreferences } from '../services/prompt'
import { applyAgentRules } from '../services/rules'
import { emitAgentEvent } from '../services/webhook-events'

const log = createLogger('INBOUND')

/**
 * Persist one inbound WhatsApp message and decide what happens next.
 *
 * Provider-agnostic: the webhook route already normalised Evolution Go's
 * whatsmeow envelope or Evolution v2's into the same `NormalizedInbound`, and the
 * inner WhatsApp protobuf object is identical for both.
 *
 * This is the body of what used to run inside the webhook request. Moving it here
 * is what buys retries, per-contact ordering, and a webhook that answers in
 * milliseconds instead of waiting on media and an LLM round trip.
 */
export async function processWhatsAppInbound(job: Job<WhatsAppInboundJob>): Promise<void> {
    const { provider: providerName, inbound } = job.data

    const integration = await findIntegrationByRef(inbound.instance)
    if (!integration) {
        // Nothing to retry against: the instance is not (or no longer) ours.
        log.warn(`no integration for ${providerName} instance`, inbound.instance)
        return
    }

    const { agent } = integration
    const workspace = agent.workspace

    const decoded = decodeMessage(inbound.message, {})
    const phone = toMsisdn(inbound.chatJid)

    if (!phone) {
        log.warn('message without a resolvable sender; dropping')
        return
    }

    log.info(`message from ${phone} [${decoded.contentType}]: ${decoded.content.slice(0, 60)}`)

    await touchIntegration(integration.id)

    const { contact, conversation } = await resolveInboundContext({
        workspaceId: workspace.id,
        agentId: agent.id,
        phone,
        pushName: inbound.pushName,
        profilePicUrl: inbound.profilePicUrl,
    })

    /**
     * "PARAR" desliga o envio automático, antes de qualquer outra coisa.
     *
     * Reconhecido por palavra e não por IA: a saída não pode depender de
     * crédito, de rede nem de um modelo acertar a intenção — e precisa valer
     * mesmo que tudo o mais falhe nesta mensagem. A marca fica no paciente, e a
     * equipe continua podendo escrever normalmente.
     */
    if (isOptOut(decoded.content) && !contact.autoMessagesPausedAt) {
        await prisma.contact.update({
            where: { id: contact.id },
            data: { autoMessagesPausedAt: new Date() },
        })
        await prisma.message.create({
            data: {
                conversationId: conversation.id,
                direction: 'internal',
                content: `${contact.name || phone} pediu para parar de receber mensagens automáticas.`,
                contentType: 'text',
                isInternal: true,
                status: 'sent',
            },
        })
        log.info(`contact ${contact.id} opted out of automatic messages`)
    }

    // Reactions and empty bodies create the contact/conversation but add no turn.
    if (decoded.contentType === 'reaction' || !decoded.content) {
        log.debug('no conversational content; stopping after context resolution')
        return
    }

    /**
     * Uma mensagem já gravada não é o fim do trabalho — é uma retentativa.
     *
     * A gravação acontece cedo e o agendamento da resposta, tarde. Se qualquer
     * passo entre os dois falhar, o BullMQ reexecuta o job, a mensagem já existe
     * e a versão anterior deste código encerrava aqui: a conversa ficava sem
     * resposta para sempre. Foi exatamente o que aconteceu com a primeira
     * mensagem real recebida pelo sistema, quando o agendamento morreu num jobId
     * inválido.
     *
     * Numa retentativa, o que não é idempotente é pulado — arquivar mídia,
     * inserir, emitir webhooks de evento, aplicar regras (que podem enviar
     * mensagem). O que é idempotente segue: as guardas de humano/inativo/
     * somente-leitura continuam valendo, e `scheduleAiReply` reconhece um job já
     * existente. Assim a retentativa não responde por cima de um atendente, e
     * também não deixa o paciente no silêncio.
     */
    const externalId = inbound.externalId
    const existing = externalId
        ? await prisma.message.findFirst({
              where: { conversationId: conversation.id, externalId },
              select: { id: true },
          })
        : null
    const isRetry = existing !== null
    if (isRetry) log.info(`message ${externalId} already stored; re-running the reply decision only`)

    // Measured before the insert, so a rule can ask "how long were they quiet?"
    const previous = await prisma.message.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    })
    const minutesSinceLastMessage = previous
        ? (Date.now() - previous.createdAt.getTime()) / 60_000
        : undefined

    let mediaUrl = decoded.mediaUrl ?? undefined
    let transcript: string | null = null
    if (!isRetry && decoded.contentType === 'audio' && inbound.mediaBase64) {
        // Antes de arquivar, enquanto os bytes ainda estão em memória.
        transcript = await transcribeAudio(inbound.mediaBase64, inbound.mediaMimetype).catch((error) => {
            log.warn('falha ao transcrever; seguindo sem texto', error)
            return null
        })
    }
    if (!isRetry && decoded.contentType !== 'text') {
        try {
            const { provider, credentials } = providerFor(integration)
            const archived = await archiveInboundMedia({
                workspaceId: workspace.id,
                conversationId: conversation.id,
                base64: inbound.mediaBase64,
                mimetype: inbound.mediaMimetype,
                provider,
                credentials,
                downloadPayload: inbound.downloadPayload,
            })
            if (archived) mediaUrl = archived
        } catch (error) {
            // The provider's own URL is encrypted and will not render, but keeping
            // the text of the message still beats failing the job.
            log.error('media archiving failed; keeping original url', error)
        }
    }

    const stored = existing
        ? existing
        : await prisma.message.create({
              data: {
                  conversationId: conversation.id,
                  direction: 'inbound',
                  content: decoded.content,
                  contentType: decoded.contentType,
                  mediaUrl,
                  sentBy: 'user',
                  externalId,
                  transcript,
              },
          })

    // `previous` was read before the insert, so its absence means this message
    // opened the thread.
    if (!isRetry && !previous) {
        await emitAgentEvent(agent.id, 'conversation.started', {
            conversationId: conversation.id,
            contactId: contact.id,
            contactPhone: phone,
            contactName: contact.name,
        })
    }

    if (!isRetry) await emitAgentEvent(agent.id, 'message.received', {
        conversationId: conversation.id,
        messageId: stored.id,
        contactId: contact.id,
        contactPhone: phone,
        content: decoded.content,
        contentType: decoded.contentType,
        mediaUrl: mediaUrl ?? null,
    })

    // A reply from the contact proves they saw everything we sent before it.
    await prisma.message.updateMany({
        where: {
            conversationId: conversation.id,
            direction: 'outbound',
            status: { in: ['sent', 'delivered'] },
        },
        data: { status: 'read' },
    })

    await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
    })

    if (isHumanHandled(conversation)) {
        log.info(`conversation ${conversation.id} is human-handled; no agent reply`)
        return
    }

    if (!agent.isActive) {
        log.info(`agent ${agent.id} is inactive; message stored only`)
        return
    }

    const openDeal = await prisma.deal.findFirst({
        where: { workspaceId: workspace.id, contactId: contact.id, status: 'open' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    })

    const ruleContext: RuleContext = {
        workspaceId: workspace.id,
        agentId: agent.id,
        conversationId: conversation.id,
        contactId: contact.id,
        dealId: openDeal?.id ?? null,
        message: decoded.content,
        minutesSinceLastMessage,
        channel: { integrationId: integration.id, to: phone },
    }

    // A lapsed trial does not stop messages arriving — they are stored above and
    // the clinic can read them. What it stops is replying. The patient gets one
    // notice telling them to phone the clinic, so they are not left writing into
    // silence. See PRODUCT.md §3.
    const billing = await getBillingState(workspace.id)
    if (billing.readOnly) {
        const notice = await claimAutoNotice(conversation.id, 'read_only')
        if (notice) {
            await enqueueOutboundText({
                conversationId: conversation.id,
                content: notice,
                integrationId: integration.id,
                to: phone,
                sentBy: 'system',
                agentId: agent.id,
            })
        }
        log.info(`workspace ${workspace.id} is read-only; agent not scheduled`)
        return
    }

    // A saudação configurada abre toda conversa nova, literal e sem LLM.
    //
    // `initialMessage` era um campo da tela que nunca saía: gravado, duplicado
    // junto com o agente, e lido por nenhum caminho de envio. Sai aqui, só na
    // mensagem que abriu a conversa (`previous` é nulo) e só na primeira
    // passagem do job. O LLM responde ao conteúdo logo depois, no fluxo normal,
    // e vê a saudação no histórico — então não se apresenta de novo.
    const greeting = agent.initialMessage?.trim()
    if (!isRetry && !previous && greeting) {
        await enqueueOutboundText({
            conversationId: conversation.id,
            content: greeting,
            integrationId: integration.id,
            to: phone,
            sentBy: 'agent',
            agentId: agent.id,
        })
        log.info(`conversation ${conversation.id} opened; initial message sent`)
    }

    // Regras podem enviar mensagem e transferir conversa: não se repetem.
    const rules = isRetry
        ? { handedToHuman: false, repliedWithRuleMessage: false }
        : await applyAgentRules(agent, ruleContext)

    if (rules.handedToHuman) {
        log.info(`rules escalated conversation ${conversation.id} to a human`)
        return
    }

    if (rules.repliedWithRuleMessage) {
        log.info(`rules already answered conversation ${conversation.id}`)
        return
    }

    const prefs = readPreferences(agent)
    await scheduleAiReply(
        {
            conversationId: conversation.id,
            agentId: agent.id,
            workspaceId: workspace.id,
            integrationId: integration.id,
            to: phone,
        },
        delayForSpeed(prefs.responseSpeed, env.INBOUND_DEBOUNCE_SECONDS)
    )
}
