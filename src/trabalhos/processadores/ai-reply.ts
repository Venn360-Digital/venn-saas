import { claimAutoNotice } from '@/lib/auto-notice'
import { instrucaoDeFala, vozValida } from '@/lib/voz'
import prisma from '@/lib/prisma'
import { findIntegrationById, providerFor } from '@/trabalhos/servicos/integration'
import { createLogger } from '@/trabalhos/registro'
import type { AiReplyJob } from '@/lib/queue/definitions'
import { OutOfCreditsError, generateReply } from '@/trabalhos/servicos/ai-reply'
import { readPreferences } from '@/trabalhos/servicos/prompt'
import { enqueueOutboundAudio, enqueueOutboundText } from '@/trabalhos/servicos/outbound'
import { MIMETYPE_DA_FALA, falar } from '@/trabalhos/servicos/speech'
import { spendAiCredits, trackSpeechUsage } from '@/lib/llm/usage-tracker'
import { getBillingState, spokenRepliesLeft } from '@/lib/billing'
import { concluirResposta } from '@/trabalhos/agenda'

const log = createLogger('AI_REPLY_JOB')

/**
 * Abaixo de quantos créditos o agente entra em modo econômico.
 *
 * **Degradar antes de calar.** Emudecer é o pior desfecho possível no pior
 * momento possível: o paciente está escrevendo e a clínica não sabe. Com a
 * carteira no fim, cai primeiro o áudio (custa cerca de dez vezes o texto) e
 * depois a ferramenta (multiplica as idas ao modelo por duas a três). O que
 * resta — responder por escrito, pelo que o agente sabe — custa um décimo e
 * estica o saldo dez vezes.
 *
 * Número absoluto, e não percentual da franquia: um workspace que vive de
 * crédito avulso não tem franquia de que ser percentual. Duzentos é cerca de um
 * dia de uso do plano menor.
 */
const MODO_ECONOMIA_ABAIXO_DE = 200

/**
 * Rede de segurança embaixo do recorte por atendimento. Ver `desdeQuandoContar`.
 */
const JANELA_DO_LIMITE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * De quando contar as respostas do agente neste atendimento.
 *
 * **Finalizar a conversa recomeça a contagem** — é o recorte que o Andre
 * definiu, e é o certo: finalizar é o que encerra um atendimento, e a conversa
 * de um paciente que volta é *reaberta*, não recriada. Sem recorte a contagem
 * era vitalícia, e com o limite em 12 o agente ficaria mudo para sempre com quem
 * fala muito com a clínica.
 *
 * E a janela de 30 dias fica embaixo, como rede: o fechamento automático
 * (`CONVERSATION_AUTOCLOSE_HOURS`) está **desligado por padrão**, então numa
 * clínica que nunca finaliza nada o critério de cima nunca dispararia e o
 * problema voltaria por outro caminho. Vence a mais recente das duas.
 */
function desdeQuandoContar(closedAt: Date | null): Date {
    const rede = new Date(Date.now() - JANELA_DO_LIMITE_MS)
    if (!closedAt) return rede
    return closedAt > rede ? closedAt : rede
}

/**
 * Gera e envia a resposta do agente, e **sempre libera a conversa**.
 *
 * O `finally` não é zelo: é obrigatório, e é novo nesta arquitetura.
 *
 * O debounce agora é um Durable Object por conversa que marca `gerando` **antes**
 * de enfileirar — nessa ordem, a mensagem que chega entre o enfileiramento e o
 * início da geração não agenda uma segunda resposta. O preço dessa garantia é
 * que alguém tem de desmarcar, e só este consumidor sabe quando a geração
 * terminou.
 *
 * Sem o `finally`, qualquer um dos caminhos abaixo deixaria a conversa presa:
 * conversa que não existe mais, atendente que assumiu durante a espera,
 * conversa finalizada, agente inativo, crédito esgotado, erro do modelo. E o
 * sintoma não seria um erro — seria **o agente parar de responder naquela
 * conversa, para sempre**, enquanto todas as outras seguem funcionando. É o
 * tipo de defeito que leva semanas para ser notado e minutos para ser
 * diagnosticado errado.
 *
 * Roda atrás do debounce (ver `scheduleAiReply`), então quando executa o
 * paciente normalmente já parou de escrever e a rajada inteira está no
 * histórico.
 */
export async function processAiReply(payload: AiReplyJob): Promise<void> {
    try {
        await gerarResposta(payload)
    } finally {
        // Mesmo quando falha: conversa travada em `gerando` é pior que uma
        // resposta a menos. `concluirResposta` não lança, de propósito — um erro
        // aqui mascararia o erro real da geração.
        await concluirResposta(payload.conversationId)
    }
}

async function gerarResposta(payload: AiReplyJob): Promise<void> {
    const { conversationId, agentId, workspaceId, integrationId, to } = payload

    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, status: true, assignedTo: true, closedAt: true },
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
                  // Só o atendimento atual. Ver `desdeQuandoContar`.
                  createdAt: { gte: desdeQuandoContar(conversation.closedAt) },
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

    // Confirma leitura ao paciente quando o agente abre a conversa.
    //
    // Honesto — o agente leu — e é o que faz o check virar azul mesmo com o
    // aparelho da clínica desligado: sem isto, o recibo de entrega automático do
    // whatsmeow não dispara e o paciente vê um check só, como se a clínica não
    // tivesse recebido (medido 2026-10-22). Melhor-esforço, nunca fatal; e no-op
    // nos provedores sem `markRead` (o Cloud API da Meta já confirma sozinho).
    if (integration && to) {
        try {
            const ultimaRecebida = await prisma.message.findFirst({
                where: { conversationId, direction: 'inbound', externalId: { not: null } },
                orderBy: { createdAt: 'desc' },
                select: { externalId: true },
            })
            if (ultimaRecebida?.externalId) {
                const { provider, credentials } = providerFor(integration)
                await provider.markRead?.(credentials, to, [ultimaRecebida.externalId])
            }
        } catch (error) {
            log.debug('could not mark read', error)
        }
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

    /**
     * Quanto resta na carteira decide o quanto o agente se permite gastar.
     *
     * Lido uma vez, antes de gerar: `checkCredits` lá dentro só responde "pode
     * ou não pode", e aqui é preciso o número para escolher entre responder
     * completo, responder econômico, ou não responder.
     */
    const billing = await getBillingState(workspaceId)
    const economia = billing.credits.available <= MODO_ECONOMIA_ABAIXO_DE

    if (economia) {
        log.info(
            `workspace ${workspaceId} com ${billing.credits.available} crédito(s): ` +
            'modo econômico — sem áudio e sem ferramenta'
        )
    }

    let content: string
    try {
        const reply = await generateReply({
            agent,
            workspaceId,
            conversationId,
            semFerramentas: economia,
        })
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
    const podeFalar =
        agent.voiceEnabled && integration !== null && !economia && (await spokenRepliesLeft(workspaceId)) > 0

    const fala = podeFalar
            ? await falar({
                  texto: content,
                  voz: vozValida(agent.voiceModel),
                  /* Os dois parâmetros da aba Voz, e nada além deles —
                     ver `lib/voz.ts`. */
                  instrucoes: instrucaoDeFala({
                      entonacao: agent.voiceTraining,
                      tom: agent.voiceTone,
                  }),
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

    /**
     * O crédito é debitado **aqui**, uma vez, depois de a resposta existir.
     *
     * Não por chamada ao modelo: a resposta que consulta a agenda usa de 4 a 6
     * chamadas e vale para a clínica o mesmo que a resposta simples. E não antes
     * de entregar: resposta que o modelo devolveu vazia não chega ao paciente e
     * não custa crédito a ele — o nosso custo fica em `usage_logs`, que é onde
     * ele deve ficar.
     *
     * Contabilizar não pode engolir uma resposta pronta, pela mesma razão que
     * vale no medidor de uso.
     */
    try {
        // Um crédito, falada ou escrita. A fala é controlada por **teto**
        // (`maxSpokenReplies`), não por peso: com crédito abstrato, peso
        // variável deixa a carteira imprevisível para quem olha a tela.
        await spendAiCredits(workspaceId, 1, fala ? 'resposta falada' : 'resposta')
    } catch (error) {
        log.error(`credit debit failed for workspace ${workspaceId}`, error)
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
