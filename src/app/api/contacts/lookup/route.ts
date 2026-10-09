import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'
import { connectedWhatsApp, formatPhone, hasWhatsApp, normalizePhone, phoneVariants } from '@/lib/intake'

/**
 * Quem é este número, antes de gravar qualquer coisa.
 *
 * Responde três perguntas de uma vez, porque é o que a tela precisa saber antes
 * de deixar criar: o número é plausível, já existe paciente com ele, e ele tem
 * WhatsApp. A ordem importa — um paciente já cadastrado dispensa a verificação
 * no provedor, e descobrir isso primeiro evita uma chamada de rede por tecla.
 *
 * Nada é criado aqui. É o que impede um dígito trocado de virar paciente,
 * negócio e cartão no funil para um número que nunca vai receber mensagem.
 */
export async function GET(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const raw = new URL(request.url).searchParams.get('phone') ?? ''
    const { digits, valid } = normalizePhone(raw)
    if (!valid) {
        return NextResponse.json({ valid: false, phone: digits, formatted: formatPhone(digits) })
    }

    // As duas formas, porque o nono dígito separa a ficha criada à mão da que
    // o WhatsApp cria — e as duas são a mesma pessoa.
    const variants = phoneVariants(digits)
    const contact = await prisma.contact.findFirst({
        where: { workspaceId: auth.member.workspaceId, phone: { in: variants } },
        select: { id: true, name: true, phone: true },
    })

    let existing = null
    if (contact) {
        const [deal, conversation] = await Promise.all([
            prisma.deal.findFirst({
                where: { workspaceId: auth.member.workspaceId, contactId: contact.id, status: 'open' },
                orderBy: { createdAt: 'desc' },
                select: { id: true, title: true, stage: { select: { name: true } } },
            }),
            prisma.conversation.findFirst({
                where: { workspaceId: auth.member.workspaceId, contactId: contact.id },
                orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
                select: { id: true, status: true, lastMessageAt: true },
            }),
        ])
        existing = {
            contactId: contact.id,
            name: contact.name,
            dealId: deal?.id ?? null,
            stageName: deal?.stage?.name ?? null,
            conversationId: conversation?.id ?? null,
            lastMessageAt: conversation?.lastMessageAt ?? null,
        }
    }

    // Paciente conhecido já provou que o número existe: a conversa só existe
    // porque alguém escreveu por ela.
    const checked = existing?.conversationId
        ? { exists: true as boolean | undefined, canonical: contact?.phone ?? null }
        : await hasWhatsApp(auth.member.workspaceId, digits)

    /**
     * A forma que será gravada.
     *
     * Ordem de autoridade: o JID que o WhatsApp devolveu, depois a ficha que já
     * existe, depois o que foi digitado. É o que garante que a mensagem que
     * chegar amanhã caia nesta ficha em vez de abrir uma segunda.
     */
    const canonical = checked.canonical ?? contact?.phone ?? digits

    const channel = await connectedWhatsApp(auth.member.workspaceId)

    return NextResponse.json({
        valid: true,
        phone: canonical,
        typed: digits,
        formatted: formatPhone(canonical),
        existing,
        /** `true` tem, `false` não tem, `null` não deu para verificar. */
        whatsapp: checked.exists ?? null,
        /** Sem canal conectado não há como abrir conversa — só registrar. */
        channelConnected: Boolean(channel),
    })
}
