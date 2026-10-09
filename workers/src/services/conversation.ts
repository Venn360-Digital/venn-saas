import type { Contact, Conversation } from '@prisma/client'
import prisma from '@/lib/prisma'
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

    const existing = await prisma.contact.findFirst({ where: { workspaceId, phone } })

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

    const patch: { name?: string; avatar?: string } = {}
    if (pushName && existing.name !== pushName) patch.name = pushName
    if (profilePicUrl && existing.avatar !== profilePicUrl) patch.avatar = profilePicUrl

    if (Object.keys(patch).length === 0) return existing
    return prisma.contact.update({ where: { id: existing.id }, data: patch })
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

    await prisma.deal.create({
        data: {
            workspaceId,
            contactId: contact.id,
            title: `Novo paciente - ${contact.name || contact.phone}`,
            stageId: firstStage.id,
            source: 'whatsapp',
            status: 'open',
        },
    })
    log.info(`auto-created deal for contact ${contact.id}`)
}

/**
 * Get the conversation to append to: the open one, the most recent closed one
 * reopened, or a brand new one.
 *
 * Scoped by workspace + contact rather than by agent, so a contact never ends up
 * with one thread per agent.
 */
async function resolveConversation(
    workspaceId: string,
    contactId: string,
    agentId: string
): Promise<Conversation> {
    const open = await prisma.conversation.findFirst({
        where: { workspaceId, contactId, status: { not: 'closed' } },
    })
    if (open) return open

    const closed = await prisma.conversation.findFirst({
        where: { workspaceId, contactId, status: 'closed' },
        orderBy: { updatedAt: 'desc' },
    })

    if (closed) {
        // Reopening clears the assignee, which puts the thread back in "em espera"
        // so the agent — not the previous operator — picks it up.
        const reopened = await prisma.conversation.update({
            where: { id: closed.id },
            data: { status: 'active', agentId, assignedTo: null },
        })
        log.info(`reopened conversation ${reopened.id}`)
        return reopened
    }

    return prisma.conversation.create({
        data: { workspaceId, agentId, contactId, channel: 'whatsapp', status: 'active' },
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
    phone: string
    pushName?: string | null
    profilePicUrl?: string | null
}): Promise<InboundContext> {
    const { workspaceId, agentId, phone, pushName, profilePicUrl } = input

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

            const conversation = await resolveConversation(workspaceId, contact.id, agentId)
            return { contact, conversation }
        },
        { ttlMs: 20_000, waitMs: 15_000 }
    )
}

/** True when the thread is owned by a human, meaning the agent must stay quiet. */
export function isHumanHandled(conversation: Conversation): boolean {
    return Boolean(conversation.assignedTo)
}
