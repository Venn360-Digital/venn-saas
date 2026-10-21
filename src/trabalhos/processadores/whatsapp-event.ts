import prisma from '@/lib/prisma'
import { transmitir } from '@/trabalhos/tempo-real'
import { toMsisdn } from '@/lib/whatsapp'
import type {
    NormalizedAck,
    NormalizedConnection,
    NormalizedPicture,
    NormalizedPresence,
    NormalizedRecycle,
} from '@/lib/whatsapp/envelopes'
import { webhookUrlFor } from '@/lib/whatsapp'
import { env } from '@/trabalhos/ambiente'
import { createLogger } from '@/trabalhos/registro'
import { QUEUE, type WhatsAppEventJob } from '@/lib/queue/definitions'
import { findContactByJid, syncContactProfile } from '@/trabalhos/servicos/avatar'
import { findIntegrationByRef, providerFor } from '@/trabalhos/servicos/integration'
import { enfileirar } from '@/trabalhos/filas'
import { avisarStatusDaMensagem , publicarAgora } from '@/lib/outbox/avisar'

/** Measured: the forced logout lands ~105 s after PairSuccess; sync is done by ~15 s. */
const RECYCLE_DELAY_MS = 20_000

const log = createLogger('WA_EVENT')

/**
 * The cheap provider events, already normalised at the webhook edge.
 *
 * Both providers' envelopes collapse to the same three shapes here, so nothing in
 * this file knows which one sent the event.
 */
export async function processWhatsAppEvent(payload: WhatsAppEventJob): Promise<void> {
    const { event } = payload

    switch (event.kind) {
        case 'message.ack':
            return handleAck(event)
        case 'connection':
            return handleConnection(event, payload)
        case 'presence':
            return handlePresence(event)
        case 'recycle':
            return handleRecycle(event)
        case 'contact.picture':
            return handlePicture(event)
    }
}

/**
 * O paciente trocou a foto de perfil.
 *
 * O evento só avisa que mudou; a imagem vem numa segunda consulta, e é por isso
 * que isto mora aqui e não no caminho da mensagem — uma consulta de foto já
 * pendurou 75 s contra a instância de produção, e nenhuma mensagem pode esperar
 * por um enfeite.
 *
 * Contato que ainda não existe é ignorado em silêncio: a foto chega de volta na
 * próxima troca, e criar ficha a partir de um evento de foto inventaria
 * paciente a cada contato da agenda do aparelho.
 */
async function handlePicture(event: NormalizedPicture): Promise<void> {
    if (!event.jid || event.jid.endsWith('@g.us')) return

    const integration = await findIntegrationByRef(event.instance)
    if (!integration) return

    const workspaceId = integration.agent.workspaceId
    const contact = await findContactByJid(workspaceId, event.jid)
    if (!contact) return

    const { provider, credentials } = providerFor(integration)
    await syncContactProfile({
        contactId: contact.id,
        workspaceId,
        externalId: contact.phone,
        provider,
        credentials,
        removed: event.removed,
    })
}

/**
 * Close and reopen one instance's socket, keeping its pairing.
 *
 * Runs ~20 s after PairSuccess. Reconnecting by the stored JID issues no QR, and
 * the client restart drops the QR goroutine Evolution Go left counting toward
 * its forced logout. Any failure here is logged and nothing else: the worst
 * outcome is the status quo, and the status quo is the manual container restart.
 */
async function handleRecycle(event: NormalizedRecycle): Promise<void> {
    const integration = await findIntegrationByRef(event.instance)
    if (!integration) {
        log.warn('no integration for recycle', event.instance)
        return
    }

    const { provider, credentials } = providerFor(integration)
    if (!provider.disconnect) return

    // Guard on the stored JID, never on `loggedIn`. Measured on the first run of
    // this job: for the whole three minutes after PairSuccess the instance
    // reported LoggedIn=false — that is the reconnect window the recycle exists
    // to break out of. A `loggedIn` guard vetoed the one action that would have
    // made it true, and the session was lost to the QR loop as before.
    const jid = provider.getOwnerJid ? await provider.getOwnerJid(credentials).catch(() => undefined) : undefined
    if (!jid) {
        // Never paired, or unpaired within the delay: a reconnect would start a
        // QR cycle instead of resuming a session.
        log.warn(`integration ${integration.id}: no paired device at recycle time; skipping`)
        return
    }

    await provider.disconnect(credentials)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await provider.connect(credentials, webhookUrlFor('evolution-go'))

    const after = await provider.getConnectionState(credentials).catch(() => null)
    log.info(
        `integration ${integration.id} recycled after pairing → ` +
            `loggedIn=${after?.loggedIn ?? '?'} socket=${after?.socketOpen ?? '?'}`
    )
}

/** Advance delivery status for the messages a receipt covers. */
async function handleAck(event: NormalizedAck): Promise<void> {
    if (event.messageIds.length === 0) return

    /**
     * Uma leitura antes da escrita, e ela paga por si.
     *
     * O `updateMany` por `externalId` não diz **quais** linhas tocou, e para
     * avisar a tela é preciso saber a conversa e o workspace de cada uma.
     * Sem o aviso, o selo de entrega (enviada → entregue → lida) só mudaria
     * quando a atendente trocasse de conversa — regressão visível em relação
     * ao que o Supabase Realtime fazia.
     *
     * Um `findMany` por lote de recibos, e o lote chega com até 25 (ver
     * `CONSUMO` em `cloudflare.config.ts`). Recibo é barato e tagarela; isto
     * continua barato.
     */
    const alvos = await prisma.message.findMany({
        where: { externalId: { in: event.messageIds } },
        select: {
            id: true,
            conversationId: true,
            conversation: { select: { agent: { select: { workspaceId: true } } } },
        },
    })

    if (alvos.length === 0) {
        log.debug(`nenhuma mensagem para os ${event.messageIds.length} recibo(s)`)
        return
    }

    await prisma.$transaction(async (tx) => {
        await tx.message.updateMany({
            where: { id: { in: alvos.map((m) => m.id) } },
            data: { status: event.status },
        })

        for (const alvo of alvos) {
            const workspaceId = alvo.conversation?.agent?.workspaceId
            // Sem workspace não há sala para avisar. Acontece em conversa cujo
            // agente foi apagado; a atualização do selo vale, o aviso não.
            if (!workspaceId) continue

            await avisarStatusDaMensagem(tx, {
                workspaceId,
                conversationId: alvo.conversationId,
                messageId: alvo.id,
                status: event.status,
            })
        }
    })

    publicarAgora()
    log.debug(`marked ${alvos.length} message(s) as ${event.status}`)
}

/** Keep `agent_integrations.status` in sync with the provider's socket state. */
async function handleConnection(event: NormalizedConnection, job: WhatsAppEventJob): Promise<void> {
    const integration = await findIntegrationByRef(event.instance)

    if (!integration) {
        log.warn('no integration for connection event', event.instance)
        return
    }

    if (event.paired && job.provider === 'evolution-go' && env.EVOLUTION_GO_RECYCLE_AFTER_PAIR === 'true') {
        const recycle: NormalizedRecycle = {
            provider: job.provider,
            kind: 'recycle',
            instance: event.instance,
            rawEvent: 'PairSuccess',
        }
        await enfileirar(
            QUEUE.WHATSAPP_EVENT,
            { provider: job.provider, event: recycle, receivedAt: new Date().toISOString() },
            // O `jobId` que havia aqui carregava `Date.now()`, então era único a
            // cada chamada e nunca deduplicou nada — era rótulo, não garantia.
            { atrasoSegundos: RECYCLE_DELAY_MS / 1000 }
        )
        log.info(`integration ${integration.id} paired; socket recycle scheduled in ${RECYCLE_DELAY_MS / 1000}s`)
    }

    const status =
        event.state === 'connected'
            ? 'connected'
            : event.state === 'disconnected'
              ? 'disconnected'
              : 'pending'

    const config = (integration.config ?? {}) as Record<string, unknown>

    // The owner number is only knowable once connected; it is how the UI shows
    // which number is paired. Evolution Go puts it on the Connected event.
    let phoneNumber = event.phoneNumber
    if (event.state === 'connected' && !phoneNumber) {
        try {
            const { provider, credentials } = providerFor(integration)
            const state = await provider.getConnectionState(credentials)
            phoneNumber = state.phoneNumber
        } catch (error) {
            log.warn('could not resolve owner number', error)
        }
    }

    // `phoneNumber` na configuração significa "existe um pareamento vivo", e a
    // rota de status usa exatamente isso para decidir que uma sessão fora do ar é
    // reconexão e não deve pedir QR. Um LoggedOut desfaz o pareamento, então o
    // número precisa sair junto — senão o workspace ficaria preso: sem sessão,
    // e sem conseguir exibir um QR novo para parear de novo.
    const nextConfig =
        event.state === 'disconnected'
            ? Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'phoneNumber'))
            : phoneNumber
              ? { ...config, phoneNumber }
              : config

    await prisma.agentIntegration.update({
        where: { id: integration.id },
        data: {
            status,
            connectedAt: event.state === 'connected' ? new Date() : undefined,
            lastActiveAt: new Date(),
            errorMessage: event.state === 'disconnected' ? 'Conexão encerrada' : null,
            config: nextConfig as never,
        },
    })

    /**
     * E o número também na coluna, que é onde ele é único no sistema inteiro.
     *
     * A coluna só era escrita pela rota HTTP, e o pareamento não passa por ela:
     * este webhook chega antes. Resultado medido na linha da Ruth logo depois de
     * parear — conectada, número no JSON, coluna nula. Com a coluna vazia a tela
     * não sabe o número da linha, o guarda de "um número por conta" fica
     * desligado para ela, e `isReconnecting` perde a referência de que ela já
     * pareou.
     *
     * Diferente do JSON, a coluna **não** é limpa no LoggedOut: uma linha fora
     * do ar continua sendo o número daquela clínica, à espera de reconectar.
     * Quem a libera é remover a linha.
     */
    if (phoneNumber && integration.phoneNumber !== phoneNumber) {
        try {
            await prisma.agentIntegration.update({
                where: { id: integration.id },
                data: { phoneNumber },
            })
        } catch {
            // O índice único recusou: este número está em outra linha, aqui ou
            // em outra conta. Não é motivo para perder o evento de conexão — a
            // sessão existe de fato. Fica registrado para a tela explicar.
            log.warn(
                `number ${phoneNumber} already belongs to another line; ` +
                `integration ${integration.id} keeps its column empty`
            )
        }
    }

    log.info(
        `integration ${integration.id} → ${status}${phoneNumber ? ` (${phoneNumber})` : ''}`
    )
}

/**
 * Relay the contact's typing state to the operator inbox.
 *
 * Ephemeral by design: broadcast over Supabase Realtime, never written to the DB.
 */
async function handlePresence(event: NormalizedPresence): Promise<void> {
    if (!event.chatJid || event.chatJid.endsWith('@g.us')) return

    const integration = await findIntegrationByRef(event.instance)
    if (!integration) return

    const conversation = await prisma.conversation.findFirst({
        where: {
            workspaceId: integration.agent.workspaceId,
            contact: { phone: toMsisdn(event.chatJid) },
            status: { not: 'closed' },
        },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
    })
    if (!conversation) return

    /**
     * Direto para a sala, nunca pelo outbox.
     *
     * "Está digitando" perde o sentido se atrasar: entregue pelo outbox,
     * chegaria depois da varredura do minuto, quando a pessoa já terminou de
     * escrever. O critério está em `trabalhos/tempo-real.ts` — tem de chegar,
     * outbox; tem de chegar agora, transmissão.
     */
    await transmitir({
        workspaceId: integration.agent.workspaceId,
        tipo: 'digitando',
        dados: {
            conversationId: conversation.id,
            isTyping: event.isTyping,
            source: 'contact',
        },
    })
}
