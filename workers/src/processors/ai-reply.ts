import { claimAutoNotice } from '@/lib/auto-notice'
import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import { findIntegrationById, providerFor } from '../services/integration'
import { createLogger } from '../logger'
import type { AiReplyJob } from '../queues'
import { OutOfCreditsError, generateReply } from '../services/ai-reply'
import { readPreferences } from '../services/prompt'
import { enqueueOutboundAudio, enqueueOutboundText } from '../services/outbound'
import { MIMETYPE_DA_FALA, falar } from '../services/speech'
import { trackSpeechUsage } from '@/lib/llm/usage-tracker'

const log = createLogger('AI_REPLY_JOB')

/**
 * Generate and send the agent's answer for one conversation.
 *
 * Runs behind a debounce (see `scheduleAiReply`), so by the time it executes the
 * customer has usually finished typing and the whole burst is in history.
 */
export async function processAiReply(job: Job<AiReplyJob>): Promise<void> {
    const { conversationId, agentId, workspaceId, integrationId, to } = job.data

    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, status: true, assignedTo: true },
    })

    if (!conversation) {
        log.warn(`conversation ${conversationId} no longer exists`)
        return
    }

    // Re-checked here, not only at enqueue time: an operator may have taken the
    // thread over during the debounce window.
    if (conversation.assignedTo) {
        log.info(`conversation ${conversationId} was taken over by a human; skipping`)
        return
    }

    if (conversation.status === 'closed') {
        log.info(`conversation ${conversationId} is closed; skipping`)
        return
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || !agent.isActive) {
        log.info(`agent ${agentId} missing or inactive; skipping`)
        return
    }

    /**
     * A conversa do site não tem canal de saída, e isso é normal.
     *
     * `integrationId` nulo significa "a resposta fica na conversa e o navegador
     * do visitante vem buscá-la". Tudo o que depende de provedor — indicador de
     * digitação, envio — é pulado; o resto do fluxo é idêntico, inclusive
     * crédito, limite de interações e as ferramentas.
     */
    const integration = integrationId ? await findIntegrationById(integrationId) : null
    if (integrationId && !integration) {
        log.warn(`integration ${integrationId} not found; cannot answer`)
        return
    }

    const prefs = readPreferences(agent)

    /**
     * O limite de interações por atendimento, que a tela oferece e ninguém lia.
     *
     * Conta as respostas que o agente já deu neste fio — inclui saudação e
     * mensagem de regra, que também são o agente falando. Ao estourar, o agente
     * se cala de vez nesta conversa (a contagem não volta a cair), a thread fica
     * sem responsável para aparecer em "Em espera", e o paciente ouve uma vez
     * que uma pessoa vai continuar. Sem o aviso, a conversa emudeceria no meio.
     *
     * É também a única trava que impede um fio em loop de queimar crédito
     * indefinidamente.
     *
     * Zero é sem limite, e é o que vale para o agente que nunca gravou
     * preferência: a conversa de um paciente antigo é reaberta na mesma linha em
     * vez de recriada, então ela acumula respostas por meses e cruzaria qualquer
     * teto que nós escolhêssemos por ele. O limite passa a valer quando a
     * clínica abre a aba Preferências e salva.
     */
    const agentReplies = prefs.interactionLimit > 0
        ? await prisma.message.count({
              where: {
                  conversationId,
                  direction: 'outbound',
                  sentBy: 'agent',
                  isInternal: false,
              },
          })
        : 0

    if (prefs.interactionLimit > 0 && agentReplies >= prefs.interactionLimit) {
        log.info(
            `conversation ${conversationId} reached the interaction limit ` +
            `(${agentReplies}/${prefs.interactionLimit}); handing over`
        )

        const notice = await claimAutoNotice(conversationId, 'interaction_limit')
        if (notice) {
            await prisma.message.create({
                data: {
                    conversationId,
                    direction: 'internal',
                    content:
                        `O agente atingiu o limite de ${prefs.interactionLimit} interações ` +
                        'neste atendimento e parou de responder. A conversa está aguardando a equipe.',
                    contentType: 'text',
                    sentBy: 'agent',
                    isInternal: true,
                    status: 'sent',
                },
            })

            await enqueueOutboundText({
                conversationId,
                content: notice,
                integrationId,
                to,
                sentBy: 'system',
                agentId,
            })
        }
        return
    }

    // Typing indicator while the model works. Cosmetic, never fatal.
    if (prefs.showTypingIndicator && integration) {
        try {
            const { provider, credentials } = providerFor(integration)
            await provider.sendPresence(credentials, to, 'composing')
        } catch (error) {
            log.debug('could not send typing presence', error)
        }
    }

    let content: string
    try {
        const reply = await generateReply({ agent, workspaceId, conversationId })
        content = reply.content.trim()
    } catch (error) {
        if (error instanceof OutOfCreditsError) {
            // Retrying will not create credits. Leave an internal note so the
            // workspace owner can see why the agent went quiet.
            log.warn(`workspace ${workspaceId} is out of credits; agent silenced`)
            await prisma.message.create({
                data: {
                    conversationId,
                    direction: 'outbound',
                    content:
                        'O agente não respondeu: os créditos de IA do workspace acabaram. ' +
                        'Recarregue o plano para retomar o atendimento automático.',
                    contentType: 'text',
                    sentBy: 'agent',
                    isInternal: true,
                    status: 'sent',
                },
            })

            // And tell the patient something, once. Silence costs the clinic a
            // patient, which costs us the clinic.
            const notice = await claimAutoNotice(conversationId, 'out_of_credits')
            if (notice) {
                await enqueueOutboundText({
                    conversationId,
                    content: notice,
                    integrationId,
                    to,
                    sentBy: 'agent',
                    agentId,
                })
            }
            return
        }
        throw error
    }

    if (!content) {
        log.warn(`model returned an empty reply for conversation ${conversationId}`)
        return
    }

    /**
     * Com a voz ligada, o agente fala — e se não der, escreve.
     *
     * Três condições, todas necessárias. `voiceEnabled`, porque é a clínica que
     * escolhe. Uma linha de verdade (`integration`), porque nota de voz precisa
     * de provedor que a entregue: a conversa do site não tem, e lá a resposta
     * segue como texto. E a fala tem que ter sido gerada — `falar` devolve nulo
     * em toda falha, de propósito, para que modelo sem permissão, OpenAI fora do
     * ar ou Storage recusando custem o áudio, nunca a resposta.
     *
     * O crédito é debitado **depois** de a fala existir, e pelo caminho próprio
     * da fala: ela não tem relatório de uso, então o custo sai do tamanho do
     * texto (ver `TTS_MODELS`). Falhar a contabilidade não engole a resposta,
     * pela mesma razão que valia na conversa.
     */
    const fala =
        agent.voiceEnabled && integration
            ? await falar({
                  texto: content,
                  voz: agent.voiceModel || 'nova',
                  instrucoes: agent.voiceTraining,
                  workspaceId,
                  conversationId,
              })
            : null

    // `&& integration` repetido para o compilador estreitar o tipo: ele não
    // carrega a condição de cima através do ternário.
    if (fala && integration) {
        try {
            await trackSpeechUsage(fala.model, fala.characters, {
                workspaceId,
                agentId: agent.id,
                metadata: { conversationId, channel: 'whatsapp' },
            })
        } catch (error) {
            log.error(`speech usage tracking failed for workspace ${workspaceId}`, error)
        }

        await enqueueOutboundAudio({
            conversationId,
            content,
            mediaUrl: fala.url,
            mimetype: MIMETYPE_DA_FALA,
            integrationId: integration.id,
            to,
            sentBy: 'agent',
            agentId,
        })
    } else {
        await enqueueOutboundText({ conversationId, content, integrationId, to, sentBy: 'agent', agentId })
    }

    if (prefs.showTypingIndicator && integration) {
        try {
            const { provider, credentials } = providerFor(integration)
            await provider.sendPresence(credentials, to, 'paused')
        } catch {
            // Clearing the indicator is best-effort.
        }
    }
}
