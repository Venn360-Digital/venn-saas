import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, contactScope, getWorkspaceMember, hasEditorRole } from '@/lib/auth/workspace'
import { normalizePhone } from '@/lib/intake'

// GET - Get contact details with full history
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const auth = await getWorkspaceMember()
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
        const workspaceUser = auth.member

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const contact = await prisma.contact.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId,
            // Esconder da lista não é autorização: o id na URL abre a ficha
            // inteira, então o recorte vale aqui também.
                ...contactScope(workspaceUser),
            },
            include: {
                origin: { select: { id: true, name: true } },
                tags: {
                    include: { tag: { select: { id: true, name: true, color: true } } }
                },
                deals: {
                    include: {
                        stage: { select: { id: true, name: true, color: true } }
                    },
                    orderBy: { createdAt: 'desc' },
                },
                conversations: {
                    select: {
                        id: true,
                        channel: true,
                        status: true,
                        createdAt: true,
                        updatedAt: true,
                        lastMessageAt: true,
                        agent: { select: { id: true, name: true } },
                        /**
                         * A linha por onde a conversa entrou.
                         *
                         * É o fato técnico que a ficha não contava: a tela
                         * mostrava **origem** (marketing, editável) e o
                         * paciente podia ter chegado por qualquer canal sem
                         * que isso aparecesse. Vem da conversa porque é dela —
                         * a mesma pessoa pode voltar por outro número.
                         */
                        integration: {
                            select: {
                                id: true,
                                channel: true,
                                label: true,
                                phoneNumber: true,
                            },
                        },
                        tags: {
                            include: { tag: { select: { id: true, name: true, color: true } } }
                        },
                        _count: { select: { messages: true } },
                    },
                    orderBy: { updatedAt: 'desc' },
                },
            }
        })

        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        // Merge tags
        const tagMap = new Map<string, { id: string; name: string; color: string }>()
        for (const ct of contact.tags) {
            tagMap.set(ct.tag.id, ct.tag)
        }
        for (const conv of contact.conversations) {
            for (const ct of conv.tags) {
                tagMap.set(ct.tag.id, ct.tag)
            }
        }

        // Calculate stats
        const totalMessages = contact.conversations.reduce((sum, c) => sum + c._count.messages, 0)
        const firstConversation = contact.conversations.length > 0
            ? contact.conversations[contact.conversations.length - 1].createdAt
            : null
        const lastConversation = contact.conversations.length > 0
            ? contact.conversations[0].lastMessageAt || contact.conversations[0].updatedAt
            : null

        // Build clean response
        const response = {
            ...contact,
            tags: Array.from(tagMap.values()).map(tag => ({ tag })),
            conversations: contact.conversations.map(c => ({
                id: c.id,
                channel: c.channel,
                linha: c.integration
                    ? {
                          channel: c.integration.channel,
                          label: c.integration.label,
                          phoneNumber: c.integration.phoneNumber,
                      }
                    : null,
                status: c.status,
                agentName: c.agent?.name || null,
                messageCount: c._count.messages,
                lastMessageAt: c.lastMessageAt,
                createdAt: c.createdAt,
            })),
            stats: {
                totalMessages,
                totalConversations: contact.conversations.length,
                totalDeals: contact.deals.length,
                openDeals: contact.deals.filter(d => d.status === 'open').length,
                wonDeals: contact.deals.filter(d => d.status === 'won').length,
                lostDeals: contact.deals.filter(d => d.status === 'lost').length,
                firstContact: firstConversation,
                lastContact: lastConversation,
            }
        }

        return NextResponse.json(response)
    } catch (error) {
        console.error('[CONTACTS_GET_ID]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// PATCH - Update contact (including custom fields and tags)
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const auth = await getWorkspaceMember()
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
        const workspaceUser = auth.member

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const existingContact = await prisma.contact.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId,
            // Esconder da lista não é autorização: o id na URL abre a ficha
            // inteira, então o recorte vale aqui também.
                ...contactScope(workspaceUser),
            }
        })

        if (!existingContact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        const body = await request.json()
        const { name, email, phone, notes, tagIds, customFields, originId } = body

        const contact = await prisma.contact.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(email !== undefined && { email }),
                // Mesma normalização do POST: a ficha editada tem de continuar
                // encontrável pelo número que o WhatsApp manda.
                ...(phone !== undefined && { phone: phone ? normalizePhone(String(phone)).digits : null }),
                ...(notes !== undefined && { notes }),
                ...(customFields !== undefined && { customFields }),
                // A origem é editável porque ninguém a detecta: a linha semeia
                // um palpite bom, e quem atende corrige quando o paciente diz
                // de onde veio. `null` é uma escolha válida — "não sabemos".
                ...(originId !== undefined && { originId: originId || null }),
            }
        })

        // Sync contact tags if tagIds provided
        if (tagIds !== undefined && Array.isArray(tagIds)) {
            await prisma.contactTag.deleteMany({ where: { contactId: id } })
            if (tagIds.length > 0) {
                await prisma.contactTag.createMany({
                    data: tagIds.map((tagId: string) => ({ contactId: id, tagId })),
                    skipDuplicates: true,
                })
            }
        }

        // Return contact with tags
        const updated = await prisma.contact.findUnique({
            where: { id },
            include: {
                origin: { select: { id: true, name: true } },
                tags: { include: { tag: { select: { id: true, name: true, color: true } } } }
            }
        })

        return NextResponse.json(updated)
    } catch (error) {
        console.error('[CONTACTS_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove contact
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const auth = await getWorkspaceMember()
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
        const workspaceUser = auth.member

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Deleting takes related records with it; an ATENDENTE may create and edit, not remove.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const existingContact = await prisma.contact.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId,
            // Esconder da lista não é autorização: o id na URL abre a ficha
            // inteira, então o recorte vale aqui também.
                ...contactScope(workspaceUser),
            }
        })

        if (!existingContact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        await prisma.contact.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[CONTACTS_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
