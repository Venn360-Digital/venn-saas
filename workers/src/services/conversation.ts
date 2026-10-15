import type { Contact, Conversation } from '@prisma/client'
import prisma from '@/lib/prisma'
import { phoneVariants } from '@/lib/whatsapp/types'
import { withLock } from '../lock'
import { createLogger } from '../logger'

const log = createLogger('CONVERSATION')

export interface ResolveContactInput {
    workspaceId: string
    phone: string
    pushName?: string | null
    profilePicUrl?: string | null
}

/**
 * Find or create the contact for an inbound WhatsApp number, keeping the
 * display name and avatar fresh.
 *
 * Callers must already hold the per-contact lock (see `resolveInboundContext`).
 */
async function resolveContact(input: ResolveContactInput): Promise<Contact> {
    const { workspaceId, phone, pushName, profilePicUrl } = input

    /**
     * As duas formas do celular brasileiro, porque uma ficha pode ter nascido
     * com a outra.
     *
     * Quem cadastra à mão digita `(31) 98850-1161`; a conta no WhatsApp pode
     * estar registrada como `553188501161`, sem o nono dígito, e é essa forma
     * que chega aqui pelo JID. Procurando só pela forma exata, a primeira
     * mensagem criava um segundo paciente ao lado do que a recepção acabara de
     * cadastrar.
     */
    const existing = await prisma.contact.findFirst({
        where: { workspaceId, phone: { in: phoneVariants(phone) } },
    })

    if (!existing) {
        return prisma.contact.create({
            data: {
                workspaceId,
                phone,
                name: pushName || `WhatsApp ${phone}`,
                avatar: profilePicUrl ?? null,
                source: 'whatsapp',
            },
        })
    }

    const patch: { name?: string; avatar?: string; phone?: string } = {}
    if (pushName && existing.name !== pushName) patch.name = pushName
    if (profilePicUrl && existing.avatar !== profilePicUrl) patch.avatar = profilePicUrl
    // O JID é a autoridade sobre a forma do número: convergir a ficha para ela
    // evita que a próxima busca exata erre de novo. Se as duas formas existirem
    // como fichas separadas (dado antigo), o índice único recusa — e aí a ficha
    // fica como está, que é melhor que abortar a mensagem.
    if (existing.phone !== phone) patch.phone = phone

    if (Object.keys(patch).length === 0) return existing
    try {
        return await prisma.contact.update({ where: { id: existing.id }, data: patch })
    } catch {
        log.warn(`could not converge contact ${existing.id} to ${phone}; keeping as is`)
        return existing
    }
}

/**
 * Drop every new WhatsApp contact into the first pipeline stage, so inbound
 * new patients show up on the Negócios board without manual entry.
 *
 * Non-fatal: a workspace with no pipeline stages yet simply gets no deal.
 */
async function ensureOpenDeal(workspaceId: string, contact: Contact): Promise<void> {
    const openDeal = await prisma.deal.findFirst({
        where: { contactId: contact.id, workspaceId, status: 'open' },
        select: { id: true },
    })
    if (openDeal) return

    const firstStage = await prisma.pipelineStage.findFirst({
        where: { workspaceId },
        orderBy: { order: 'asc' },
        select: { id: true },
    })
    if (!firstStage) {
        log.warn(`workspace ${workspaceId} has no pipeline stages; skipping deal creation`)
        return
    }

    /**
     * A primeira passagem nasce junto com o negócio.
     *
     * Sem ela o negócio criado pelo WhatsApp entrava no funil sem jornada: a
     * primeira fase ficava sem data e sem marca, "dias nesta fase" caía no
     * `createdAt` e a régua de follow-up contava de lá. Quem cria negócio pela
     * tela e pelo intake já gravava a passagem; só este caminho não gravava, e
     * é o caminho por onde entra a maioria dos pacientes.
     */
    const deal = await prisma.deal.create({
        data: {
            workspaceId,
            contactId: contact.id,
            title: `Novo paciente - ${contact.name || contact.phone}`,
            stageId: firstStage.id,
            source: 'whatsapp',
            status: 'open',
            // `userId` nulo: não foi pessoa nenhuma que moveu, foi a mensagem
            // do paciente chegando.
            stageEntries: { create: { stageId: firstStage.id } },
        },
    })
    log.info(`auto-created deal ${deal.id} for contact ${contact.id}`)
}

/**
 * Get the conversation to append to: the open one on this line, the most recent
 * closed one reopened, or a brand new one.
 *
 * **Scoped by line, not only by patient.** Antes era workspace + paciente e mais
 * nada: um paciente que escrevesse para dois números da mesma clínica — duas
 * unidades, dois consultórios — caía num fio só, e a resposta saía pela linha
 * que o `findFirst` devolvesse primeiro, que podia ser a outra. O paciente
 * recebia da unidade errada, e o histórico das duas unidades virava um só.
 *
 * Um fio por linha é também o que permite a tela filtrar por linha e a resposta
 * manual sair pelo número certo.
 */
async function resolveConversation(
    workspaceId: string,
    contactId: string,
    agentId: string,
    integrationId: string
): Promise<Conversation> {
    const open = await prisma.conversation.findFirst({
        where: { workspaceId, contactId, integrationId, status: { not: 'closed' } },
    })
    if (open) return open

    /**
     * Um fio aberto e sem linha é adotado por esta.
     *
     * É o caso da recepção: "Novo atendimento" abre a conversa antes de o
     * paciente escrever, e aí ainda não há linha nenhuma. Quando ele responde, o
     * fio que a atendente está olhando é este — criar um segundo ao lado
     * dividiria a mesma conversa em duas. O mesmo vale para o histórico cuja
     * linha a migração não conseguiu deduzir.
     */
    const unlinked = await prisma.conversation.findFirst({
        where: { workspaceId, contactId, integrationId: null, status: { not: 'closed' } },
        orderBy: { lastMessageAt: 'desc' },
    })
    if (unlinked) {
        const adopted = await prisma.conversation.update({
            where: { id: unlinked.id },
            data: { integrationId, agentId },
        })
        log.info(`conversation ${adopted.id} adopted by line ${integrationId}`)
        return adopted
    }

    const closed = await prisma.conversation.findFirst({
        where: {
            workspaceId,
            contactId,
            status: 'closed',
            OR: [{ integrationId }, { integrationId: null }],
        },
        orderBy: { updatedAt: 'desc' },
    })

    if (closed) {
        // Reopening clears the assignee, which puts the thread back in "em espera"
        // so the agent — not the previous operator — picks it up.
        const reopened = await prisma.conversation.update({
            where: { id: closed.id },
            data: {
                status: 'active',
                agentId,
                integrationId,
                assignedTo: null,
                /**
                 * Reabrir limpa o aviso automático, porque é outro atendimento.
                 *
                 * `claimAutoNotice` recusa repetir o mesmo aviso na mesma
                 * conversa, para sempre. Sem limpar aqui, um paciente que já
                 * esgotou o limite de interações uma vez teria a segunda entrega
                 * à equipe feita **em silêncio** — a conversa pararia de ser
                 * respondida sem que ninguém lhe dissesse que uma pessoa ia
                 * continuar. Idem para o aviso de crédito.
                 */
                autoNoticeAt: null,
                autoNoticeKind: null,
            },
        })
        log.info(`reopened conversation ${reopened.id}`)
        return reopened
    }

    return prisma.conversation.create({
        data: {
            workspaceId,
            agentId,
            integrationId,
            contactId,
            channel: 'whatsapp',
            status: 'active',
        },
    })
}

export interface InboundContext {
    contact: Contact
    conversation: Conversation
}

/**
 * Resolve contact, deal and conversation for an inbound message as one
 * serialised unit.
 *
 * The lock is keyed on workspace + phone, which is exactly the uniqueness scope
 * that concurrent webhooks used to violate. Deal creation runs inside the lock
 * too, because two parallel jobs would otherwise both see "no open deal".
 */
export async function resolveInboundContext(input: {
    workspaceId: string
    agentId: string
    /** A linha por onde a mensagem chegou — é o que separa os fios. */
    integrationId: string
    phone: string
    pushName?: string | null
    profilePicUrl?: string | null
}): Promise<InboundContext> {
    const { workspaceId, agentId, integrationId, phone, pushName, profilePicUrl } = input

    return withLock(
        `contact:${workspaceId}:${phone}`,
        async () => {
            const contact = await resolveContact({ workspaceId, phone, pushName, profilePicUrl })

            try {
                await ensureOpenDeal(workspaceId, contact)
            } catch (error) {
                // A missing deal must not cost us the message.
                log.error(`failed to auto-create deal for contact ${contact.id}`, error)
            }

            const conversation = await resolveConversation(
                workspaceId,
                contact.id,
                agentId,
                integrationId
            )
            return { contact, conversation }
        },
        { ttlMs: 20_000, waitMs: 15_000 }
    )
}

/** True when the thread is owned by a human, meaning the agent must stay quiet. */
export function isHumanHandled(conversation: Conversation): boolean {
    return Boolean(conversation.assignedTo)
}
