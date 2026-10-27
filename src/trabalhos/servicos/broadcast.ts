import prisma from '@/lib/prisma'
import { QUEUE } from '@/lib/queue/definitions'
import { enfileirar } from '@/trabalhos/filas'
import { resolverLinhaOficial } from '@/lib/marketing/lines'
import {
    prepararEnvioDeTemplate,
    corpoRenderizado,
    type BroadcastVariables,
} from '@/lib/marketing/templates'
import { normalizeNumber } from '@/lib/whatsapp/types'
import { createLogger } from '@/trabalhos/registro'

const log = createLogger('BROADCAST')

/**
 * Congela os destinatários de uma campanha a partir das listas que ela mira.
 *
 * Contato distinto, com telefone, não em opt-out. Idempotente: o índice único
 * `(broadcastId, contactId)` e o `skipDuplicates` deixam repopular sem duplicar.
 * Devolve quantos entraram — vira o `totalCount`.
 *
 * Roda uma vez, no disparo. Lista grande cabe em memória aqui (ids e telefones);
 * se algum dia não couber, isto vira paginação — mas não antes.
 */
export async function congelarDestinatarios(broadcastId: string): Promise<number> {
    const broadcast = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: { lists: { select: { listId: true } } },
    })
    if (!broadcast) throw new Error(`campanha ${broadcastId} não encontrada`)

    const listIds = broadcast.lists.map((l) => l.listId)
    if (listIds.length === 0) return 0

    // Contatos das listas, com telefone e sem opt-out. Distinto por contato: o
    // mesmo paciente em duas listas recebe uma vez só.
    const membros = await prisma.contact.findMany({
        where: {
            phone: { not: null },
            autoMessagesPausedAt: null,
            listMemberships: { some: { listId: { in: listIds } } },
        },
        select: { id: true, phone: true },
    })

    if (membros.length > 0) {
        await prisma.broadcastRecipient.createMany({
            data: membros.map((c) => ({
                broadcastId,
                contactId: c.id,
                to: normalizeNumber(c.phone ?? ''),
            })),
            skipDuplicates: true,
        })
    }

    const total = await prisma.broadcastRecipient.count({ where: { broadcastId } })
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { totalCount: total } })
    return total
}

/**
 * Enfileira o disparo: marca a campanha em progresso e manda o fan-out para a
 * fila. Chamado pela rota `/send` (imediato) ou pelo cron (agendado).
 */
export async function iniciarDisparo(broadcastId: string): Promise<void> {
    await prisma.broadcast.update({
        where: { id: broadcastId },
        data: { status: 'running', startedAt: new Date() },
    })
    await enfileirar(QUEUE.BROADCAST, { phase: 'fanout', broadcastId })
}

/** Teto de atraso de uma mensagem da fila da Cloudflare (~12h). */
const ATRASO_MAX_S = 12 * 60 * 60

/**
 * Expande a campanha nos envios pendentes, escalonando pelo ritmo.
 *
 * O i-ésimo pendente sai em `ceil(i * 60 / throttlePerMin)` segundos — o que dá
 * exatamente `throttlePerMin` por minuto. Além do teto de atraso da fila, o
 * disparo fica no limite (register DUVIDAS-B2: lista enorme a ritmo baixo
 * passaria de 12h; aqui os excedentes saem no teto, sem perder ninguém).
 */
export async function fanOut(broadcastId: string): Promise<void> {
    const broadcast = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: { throttlePerMin: true, status: true },
    })
    if (!broadcast) throw new Error(`campanha ${broadcastId} não encontrada`)
    if (broadcast.status === 'canceled') {
        log.info(`campanha ${broadcastId} cancelada; fan-out abortado`)
        return
    }

    const pendentes = await prisma.broadcastRecipient.findMany({
        where: { broadcastId, status: 'pending' },
        select: { id: true },
    })

    const porMin = Math.max(1, broadcast.throttlePerMin)
    let i = 0
    for (const r of pendentes) {
        const atraso = Math.min(Math.ceil((i * 60) / porMin), ATRASO_MAX_S)
        await enfileirar(
            QUEUE.BROADCAST,
            { phase: 'send', broadcastId, recipientId: r.id },
            atraso > 0 ? { atrasoSegundos: atraso } : undefined
        )
        i++
    }
    log.info(`campanha ${broadcastId}: ${i} envio(s) enfileirado(s) a ${porMin}/min`)
}

/**
 * Entrega o template a um destinatário.
 *
 * Idempotente: só age sobre destinatário `pending` (o id de dedup da fila é o
 * `recipientId`, então uma reentrega não reenvia). Grava a mensagem na conversa
 * do contato naquela linha — abrindo uma se não houver aberta — para a clínica
 * **ler** o que saiu e a resposta do paciente cair no mesmo fio.
 */
export async function enviarDestinatario(broadcastId: string, recipientId: string): Promise<void> {
    const recipient = await prisma.broadcastRecipient.findUnique({
        where: { id: recipientId },
        include: {
            broadcast: {
                include: { template: true },
            },
        },
    })
    if (!recipient) return
    if (recipient.status !== 'pending') return // já tratado — reentrega
    const { broadcast } = recipient
    if (broadcast.status === 'canceled') return

    const linha = await resolverLinhaOficial(broadcast.workspaceId, broadcast.integrationId)
    if (!linha) {
        await marcarFalha(recipientId, broadcastId, 'Linha oficial indisponível')
        return
    }

    const vars = (broadcast.variables ?? {}) as BroadcastVariables

    try {
        const conversationId = await resolverConversaDeBroadcast(
            broadcast.workspaceId,
            recipient.contactId,
            linha.integration.agentId,
            broadcast.integrationId
        )

        const message = await prisma.message.create({
            data: {
                conversationId,
                direction: 'outbound',
                content: corpoRenderizado(broadcast.template.components, vars) || `[${broadcast.template.metaName}]`,
                contentType: 'text',
                sentBy: 'broadcast',
                status: 'pending',
            },
            select: { id: true },
        })

        const envio = prepararEnvioDeTemplate(
            {
                metaName: broadcast.template.metaName,
                language: broadcast.template.language,
                components: broadcast.template.components,
            },
            vars
        )
        const { externalId } = await linha.provider.sendTemplate(linha.credentials, recipient.to, envio)

        await prisma.$transaction([
            prisma.message.update({
                where: { id: message.id },
                data: { status: 'sent', externalId: externalId ?? null },
            }),
            prisma.broadcastRecipient.update({
                where: { id: recipientId },
                data: { status: 'sent', messageId: message.id, error: null },
            }),
            prisma.broadcast.update({
                where: { id: broadcastId },
                data: { sentCount: { increment: 1 } },
            }),
        ])
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        await marcarFalha(recipientId, broadcastId, msg.slice(0, 500))
    }

    await talvezConcluir(broadcastId)
}

async function marcarFalha(recipientId: string, broadcastId: string, error: string): Promise<void> {
    await prisma.$transaction([
        prisma.broadcastRecipient.update({
            where: { id: recipientId },
            data: { status: 'failed', error },
        }),
        prisma.broadcast.update({
            where: { id: broadcastId },
            data: { failedCount: { increment: 1 } },
        }),
    ])
}

/** Fecha a campanha quando não resta nenhum destinatário pendente. */
async function talvezConcluir(broadcastId: string): Promise<void> {
    const pendentes = await prisma.broadcastRecipient.count({
        where: { broadcastId, status: 'pending' },
    })
    if (pendentes > 0) return

    const atual = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: { status: true, failedCount: true, sentCount: true },
    })
    if (!atual || atual.status !== 'running') return

    // Falhou por inteiro vira "failed"; qualquer envio bem-sucedido é "done".
    const status = atual.sentCount === 0 && atual.failedCount > 0 ? 'failed' : 'done'
    await prisma.broadcast.update({
        where: { id: broadcastId },
        data: { status, finishedAt: new Date() },
    })
    log.info(`campanha ${broadcastId} concluída como "${status}"`)
}

/**
 * Acha a conversa aberta do contato naquela linha, ou cria uma.
 *
 * **Não reabre conversa arquivada** (decisão em DUVIDAS-B2 item 4): reabrir em
 * massa poluiria "Em espera". Uma resposta posterior do paciente cai no fluxo
 * normal de inbound, que adota/reabre pela regra de lá.
 */
async function resolverConversaDeBroadcast(
    workspaceId: string,
    contactId: string,
    agentId: string,
    integrationId: string
): Promise<string> {
    const aberta = await prisma.conversation.findFirst({
        where: { workspaceId, contactId, integrationId, status: { not: 'closed' } },
        select: { id: true },
    })
    if (aberta) return aberta.id

    const criada = await prisma.conversation.create({
        data: {
            workspaceId,
            contactId,
            agentId,
            integrationId,
            channel: 'whatsapp',
            status: 'active',
        },
        select: { id: true },
    })
    return criada.id
}
