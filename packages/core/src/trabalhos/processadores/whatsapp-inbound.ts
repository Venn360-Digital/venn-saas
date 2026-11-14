import { getBillingState } from '../../lib/billing'
import { claimAutoNotice } from '../../lib/auto-notice'
import { enqueueOutboundText } from '../servicos/outbound'
import prisma from '@venn/db/cliente'
import { fusoDaUnidade } from '../../lib/fuso-da-unidade'
import { decodeMessage, toMsisdn } from '../../lib/whatsapp'
import type { RuleContext } from '../../types/rules'
import { env } from '../ambiente'
import { createLogger } from '../registro'
import type { WhatsAppInboundJob } from '../../lib/queue/definitions'
import { syncContactProfile } from '../servicos/avatar'
import { archiveInboundMedia, obterBytesDaMidia } from '../servicos/media'
import { delayForSpeed, scheduleAiReply } from '../servicos/ai-reply-schedule'
import { transcribeAudio } from '../servicos/transcribe'
import { nomeDoArquivo } from '../../lib/ai/midia-no-prompt'
import {
    ehFormatoLegivel,
    extrairTexto,
    textoParaOTranscript,
} from '../../lib/documentos/extrair'
import {
    NOME_PROVISORIO_INSTAGRAM,
    type ContactIdentity,
    isHumanHandled,
    resolveInboundContext,
} from '../servicos/conversation'
import { isOptOut } from './cron/auto-follow-up'
import { findIntegrationByRef, providerFor, touchIntegration } from '../servicos/integration'
import { readPreferences } from '../servicos/prompt'
import { applyAgentRules } from '../servicos/rules'
import { emitAgentEvent } from '../servicos/webhook-events'
import { avisarMensagemNova , publicarAgora } from '../../lib/outbox/avisar'

const log = createLogger('INBOUND')

/**
 * Persist one inbound message and decide what happens next.
 *
 * Provider-agnostic: a rota de webhook já normalizou o envelope — o do
 * whatsmeow (Evolution Go), o do Evolution v2 ou o do Instagram Direct — no
 * mesmo `NormalizedInbound`, e o objeto de mensagem lá dentro é o mesmo para os
 * três. **Daqui para frente não há canal**: contato, conversa, mídia, regras,
 * agente e crédito são um caminho só, e é isso que mantém este arquivo sem um
 * `if` por canal.
 *
 * This is the body of what used to run inside the webhook request. Moving it here
 * is what buys retries, per-contact ordering, and a webhook that answers in
 * milliseconds instead of waiting on media and an LLM round trip.
 */
export async function processWhatsAppInbound(payload: WhatsAppInboundJob): Promise<void> {
    const { provider: providerName, inbound } = payload

    const integration = await findIntegrationByRef(inbound.instance)
    if (!integration) {
        // Nothing to retry against: the instance is not (or no longer) ours.
        log.warn(`no integration for ${providerName} instance`, inbound.instance)
        return
    }

    const { agent } = integration
    const workspace = agent.workspace

    const decoded = decodeMessage(inbound.message, {})

    /**
     * Quem escreveu, no vocabulário do canal.
     *
     * No WhatsApp é o MSISDN, tirado do JID. No Instagram é o IGSID, que chega
     * cru — `toMsisdn` o atravessa sem mexer, porque não há `@` para cortar.
     */
    const senderId = toMsisdn(inbound.chatJid)

    if (!senderId) {
        log.warn('message without a resolvable sender; dropping')
        return
    }

    const isInstagram = integration.channel === 'instagram'
    const identity: ContactIdentity = isInstagram
        ? { kind: 'instagram', value: senderId }
        : { kind: 'phone', value: senderId }

    log.info(
        `${isInstagram ? 'instagram' : 'whatsapp'} message from ${senderId} ` +
            `[${decoded.contentType}]: ${decoded.content.slice(0, 60)}`
    )

    await touchIntegration(integration.id)

    const { contact, conversation } = await resolveInboundContext({
        workspaceId: workspace.id,
        agentId: agent.id,
        integrationId: integration.id,
        identity,
        channel: isInstagram ? 'instagram' : 'whatsapp',
        pushName: inbound.pushName,
        profilePicUrl: inbound.profilePicUrl,
    })

    /**
     * O perfil, em segundo plano e sem pressa.
     *
     * Sem `await` de propósito: a consulta de foto já pendurou 75 s contra a
     * instância de produção, e a mensagem do paciente não pode esperar por um
     * enfeite. Cada contato é tentado uma vez por processo — o restante da
     * regra vive no serviço.
     *
     * No Instagram isto deixa de ser enfeite: o webhook não manda nome nenhum,
     * e é esta chamada que troca o nome provisório pelo @ da conta. Por isso a
     * condição inclui o nome, e não só a foto.
     */
    if (!contact.avatar || contact.name === NOME_PROVISORIO_INSTAGRAM) {
        const { provider, credentials } = providerFor(integration)
        void syncContactProfile({
            contactId: contact.id,
            workspaceId: workspace.id,
            externalId: senderId,
            provider,
            credentials,
            currentName: contact.name,
        }).catch((error) => log.warn(`profile sync failed: ${(error as Error).message}`))
    }

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
                content: `${contact.name || senderId} pediu para parar de receber mensagens automáticas.`,
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
    if (!isRetry && decoded.contentType !== 'text') {
        try {
            const { provider, credentials } = providerFor(integration)

            /**
             * Os bytes vêm **uma vez** — do evento ou do download — e servem à
             * transcrição e ao arquivamento.
             *
             * Antes, a transcrição só acontecia com `inbound.mediaBase64`
             * presente. Desde que o base64 sai do job quando o evento não
             * cabe no Queues (toda foto, quase toda nota de voz), isso teria
             * deixado o áudio sem texto em silêncio. Baixar aqui e passar os
             * bytes adiante é o que mantém a transcrição sem baixar duas
             * vezes.
             */
            const bytes = await obterBytesDaMidia({
                base64: inbound.mediaBase64,
                mimetype: inbound.mediaMimetype,
                provider,
                credentials,
                downloadPayload: inbound.downloadPayload,
            })

            if (decoded.contentType === 'audio' && bytes) {
                // Antes de arquivar, enquanto os bytes ainda estão em memória.
                transcript = await transcribeAudio(bytes.base64, bytes.mimetype).catch((error) => {
                    log.warn('falha ao transcrever; seguindo sem texto', error)
                    return null
                })
            }

            /**
             * Documento: o texto dele vira `transcript`, como a nota de voz.
             *
             * **A mesma coluna, de propósito.** `transcript` é onde mora o texto
             * de uma mídia, e todo o resto do sistema já a lê: o histórico que vai
             * ao modelo, a consulta do Cérebro, o console de ensaio. Uma coluna
             * nova obrigaria a ensinar o mesmo conceito a quatro lugares.
             *
             * Até aqui o agente recebia o **nome do arquivo** como se fosse a fala
             * da pessoa — medido numa conta real com uma lista de orçamento em PDF.
             *
             * Formato que não sabemos ler **não é erro**: `ehFormatoLegivel`
             * decide antes de tentar, e o que sobra (imagem, planilha, zip) segue
             * sem transcript, com o aviso que `textoParaOModelo` monta. Tentar e
             * capturar a exceção daria o mesmo resultado com um log de erro falso
             * a cada foto recebida.
             */
            if (decoded.contentType === 'file' && bytes) {
                const nome = nomeDoArquivo(decoded.content)
                if (ehFormatoLegivel(nome)) {
                    try {
                        const extraido = await extrairTexto(
                            Uint8Array.from(Buffer.from(bytes.base64, 'base64')),
                            nome
                        )
                        const texto = textoParaOTranscript(extraido)
                        transcript = texto || null
                        log.info(
                            texto
                                ? `documento ${nome}: ${texto.length} caracteres extraídos`
                                : `documento ${nome}: nenhum texto — PDF digitalizado precisa de OCR`
                        )
                    } catch (error) {
                        log.warn(`falha ao extrair texto de ${nome}; seguindo sem ele`, error)
                    }
                }
            }

            const archived = await archiveInboundMedia({
                workspaceId: workspace.id,
                conversationId: conversation.id,
                base64: bytes?.base64,
                mimetype: bytes?.mimetype,
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

    /**
     * A gravação e o aviso vão na **mesma transação**.
     *
     * É o padrão do outbox, e aqui ele vale mais do que em qualquer outro
     * ponto: esta é a mensagem do paciente chegando. Gravar e falhar ao avisar
     * deixaria a mensagem no banco e a tela da atendente sem ela até o polling
     * de 15 s — e avisar sem gravar faria a tela buscar uma mensagem que não
     * existe.
     *
     * Em retentativa (`existing`) **não avisa de novo**: o aviso já foi dado na
     * primeira passagem, e repeti-lo tocaria o alerta sonoro outra vez para a
     * mesma mensagem.
     */
    const stored = existing
        ? existing
        : await prisma.$transaction(async (tx) => {
              const criada = await tx.message.create({
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

              await avisarMensagemNova(tx, {
                  workspaceId: agent.workspaceId,
                  conversationId: conversation.id,
                  messageId: criada.id,
                  direction: 'inbound',
              })

              return criada
          })

    // Logo depois do commit: a varredura é de minuto, e mensagem de paciente
    // não pode esperar um minuto para aparecer na tela.
    publicarAgora()

    // `previous` was read before the insert, so its absence means this message
    // opened the thread.
    if (!isRetry && !previous) {
        await emitAgentEvent(agent.id, 'conversation.started', {
            conversationId: conversation.id,
            contactId: contact.id,
            contactPhone: senderId,
            contactName: contact.name,
        })
    }

    if (!isRetry) await emitAgentEvent(agent.id, 'message.received', {
        conversationId: conversation.id,
        messageId: stored.id,
        contactId: contact.id,
        contactPhone: senderId,
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
        /**
         * `!previous` é a mesma leitura que decide se a saudação sai: não há
         * mensagem anterior no fio. Não dá para derivar isso de
         * `minutesSinceLastMessage`, que é **indefinido** justamente na primeira.
         */
        isFirstMessage: !previous,
        /** A condição de expediente converte isto para hora de parede do negócio. */
        agora: new Date(),
        /**
         * O relógio da unidade, para `business_hours` e para a hora da tarefa
         * que a regra agenda.
         *
         * Resolvido aqui porque o avaliador é puro de propósito: este é o único
         * lugar do caminho que já sabe qual unidade é e pode ir ao banco.
         */
        fuso: await fusoDaUnidade(workspace.id),
        channel: { integrationId: integration.id, to: senderId },
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
                to: senderId,
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
            to: senderId,
            sentBy: 'agent',
            agentId: agent.id,
        })
        log.info(`conversation ${conversation.id} opened; initial message sent`)
    }

    // Regras podem enviar mensagem, transferir e encerrar: não se repetem.
    const rules = isRetry
        ? { handedToHuman: false, repliedWithRuleMessage: false, encerrou: false }
        : await applyAgentRules(agent, ruleContext)

    if (rules.handedToHuman) {
        log.info(`rules escalated conversation ${conversation.id} to a human`)
        return
    }

    /**
     * Encerrada por regra: o agente não responde.
     *
     * Vem antes de `repliedWithRuleMessage` porque encerrar é o desfecho mais
     * forte — e porque a regra que encerra costuma enviar uma despedida na mesma
     * passada, então as duas bandeiras sobem juntas e esta é a que explica o log.
     */
    if (rules.encerrou) {
        log.info(`rules closed conversation ${conversation.id}`)
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
            to: senderId,
        },
        delayForSpeed(prefs.responseSpeed, env.INBOUND_DEBOUNCE_SECONDS)
    )
}
