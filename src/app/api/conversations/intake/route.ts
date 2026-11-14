import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@/lib/billing'
import { MANAGER_ROLES, getWorkspaceMember } from '@/lib/auth/workspace'
import { connectedWhatsApp, hasWhatsApp, normalizePhone, phoneVariants } from '@/lib/intake'
import { contatoCriado } from '@/lib/funil/disparos'

type Mode = 'active' | 'call'

/**
 * Abrir um atendimento que a clínica começou.
 *
 * Dois sentidos, um caminho: a clínica escreve primeiro (`active`) ou o
 * paciente ligou (`call`). Os dois criam os mesmos registros que o primeiro
 * inbound já criaria — paciente, negócio na primeira etapa, conversa —, porque
 * um segundo conjunto de regras para "paciente cadastrado à mão" acabaria
 * divergindo do que o webhook faz.
 *
 * A diferença entre os modos é só o que mais fica gravado: a ligação vira uma
 * atividade concluída e uma nota interna, e nada é enviado ao paciente.
 *
 * Nada é criado quando o paciente já existe com aquele telefone: a função
 * encontra e devolve. É `Contact(workspaceId, phone)` sendo único que garante
 * isso — e é o mesmo índice pelo qual a mensagem que chegar depois cai nesta
 * ficha, em vez de abrir um segundo fio.
 */
export async function POST(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { workspaceId, userId } = auth.member
    const writable = await requireWritable(workspaceId)
    if (!writable.ok) return NextResponse.json({ error: writable.error }, { status: writable.status })

    const body = await request.json()
    const mode: Mode = body.mode === 'call' ? 'call' : 'active'
    const { digits, valid } = normalizePhone(String(body.phone ?? ''))
    if (!valid) return NextResponse.json({ error: 'Telefone inválido' }, { status: 400 })

    const name = String(body.name ?? '').trim()
    const callNotes = String(body.callNotes ?? '').trim()
    const originId = body.originId ? String(body.originId) : null
    const mediaId = body.mediaId ? String(body.mediaId) : null

    const channel = await connectedWhatsApp(workspaceId)
    if (!channel) {
        // Quem não administra não tem essa tela no menu: mandá-lo conectar o
        // canal é mandá-lo a uma porta que ele não tem.
        const podeConectar = MANAGER_ROLES.includes(auth.member.role)
        return NextResponse.json(
            {
                error: podeConectar
                    ? 'Nenhum WhatsApp conectado. Conecte um canal em Agentes de IA antes de abrir uma conversa.'
                    : 'Nenhum WhatsApp conectado. Avise um administrador para conectar um canal antes de abrir uma conversa.',
            },
            { status: 409 }
        )
    }

    // ── paciente ──
    // A ficha é procurada pelas duas formas do número e, se não existir, criada
    // na forma que o WhatsApp endereça: é por ela que a mensagem vai chegar.
    // Repetir a verificação aqui custa uma chamada e fecha a janela em que o
    // cliente mandaria a forma digitada em vez da canônica.
    const existingContact = await prisma.contact.findFirst({
        where: { workspaceId, phone: { in: phoneVariants(digits) } },
    })
    const canonical = existingContact?.phone
        ?? (await hasWhatsApp(workspaceId, digits)).canonical
        ?? digits

    /**
     * `ehNovo` separa "a recepção abriu a ficha de alguém que já existia" de
     * "chegou gente nova".
     *
     * Sem a distinção, o funil de boas-vindas dispararia a cada vez que a
     * recepção abrisse um atendimento para um paciente antigo.
     */
    const ehNovo = !existingContact

    const contact =
        existingContact ??
        (await prisma.contact.create({
            data: {
                workspaceId,
                phone: canonical,
                name: name || `WhatsApp ${canonical}`,
                // Quem abre por aqui é a recepção: ou ela ligou, ou ela
                // digitou. A origem comercial é a que ela escolheu na tela, e
                // vale para a ficha e para o negócio — é a mesma lista.
                createdVia: mode === 'call' ? 'ligacao' : 'manual',
                originId,
                lastContactAt: new Date(),
            },
        }))

    // Nome digitado depois vale mais que o placeholder gravado antes.
    if (name && contact.name !== name && contact.name?.startsWith('WhatsApp ')) {
        await prisma.contact.update({ where: { id: contact.id }, data: { name } })
    }

    // ── negócio ──
    let deal = await prisma.deal.findFirst({
        where: { workspaceId, contactId: contact.id, status: 'open' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, stageId: true },
    })

    if (!deal) {
        const firstStage = await prisma.pipelineStage.findFirst({
            where: { workspaceId },
            orderBy: { order: 'asc' },
            select: { id: true },
        })
        if (!firstStage) {
            return NextResponse.json(
                { error: 'O funil não tem etapas. Crie a primeira etapa em Vendas → Negócios.' },
                { status: 409 }
            )
        }
        const created = await prisma.deal.create({
            data: {
                workspaceId,
                contactId: contact.id,
                userId,
                title: `Novo paciente - ${name || canonical}`,
                stageId: firstStage.id,
                status: 'open',
                originId,
                mediaId,
            },
            select: { id: true, stageId: true },
        })
        // A entrada da primeira fase, com a data de hoje: é ela que faz a
        // Jornada mostrar "Em atendimento · 09/10" em vez de uma fase sem data.
        await prisma.dealStageEntry.create({
            data: { dealId: created.id, stageId: created.stageId, userId, enteredAt: new Date() },
        })
        deal = created
    } else if (originId || mediaId) {
        await prisma.deal.update({
            where: { id: deal.id },
            data: {
                ...(originId ? { originId } : {}),
                ...(mediaId ? { mediaId } : {}),
            },
        })
    }

    // ── conversa ──
    // A mais recente serve, aberta ou fechada: um paciente tem um fio, não um
    // fio por tentativa. Fechada, reabre — é o que `resolveInboundContext` faz
    // quando o paciente volta a escrever.
    const previous = await prisma.conversation.findFirst({
        where: { workspaceId, contactId: contact.id },
        orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
        select: { id: true, status: true, integrationId: true, agentId: true },
    })

    /**
     * A linha do fio que o paciente já tem, quando ele tem um.
     *
     * A clínica pode atender por dois números, e `connectedWhatsApp` devolve
     * sempre o mais recentemente conectado. Reaproveitar o fio do paciente mas
     * responder pelo outro número faria a conversa continuar vindo de um
     * remetente novo, do nada. Só um paciente sem fio nenhum recebe a linha
     * padrão da clínica.
     */
    const line = previous?.integrationId ?? channel.integration.id
    const lineAgentId = previous?.integrationId ? (previous.agentId ?? channel.agentId) : channel.agentId

    const conversation = previous
        ? await prisma.conversation.update({
            where: { id: previous.id },
            data: {
                status: 'active',
                // Atribuída a quem registrou: sem isso a conversa cairia na
                // fila de espera, e ninguém está esperando resposta nela. O
                // portão vai junto pela mesma razão — a recepção já atendeu
                // esta pessoa, no balcão ou no telefone, e a IA não tem vez.
                assignedTo: userId,
                atendidaPor: 'humano',
                agentId: lineAgentId,
                integrationId: line,
            },
            select: { id: true },
        })
        : await prisma.conversation.create({
            data: {
                workspaceId,
                contactId: contact.id,
                agentId: channel.agentId,
                integrationId: channel.integration.id,
                channel: 'whatsapp',
                status: 'active',
                assignedTo: userId,
                // Nasce com a equipe: foi a recepção que registrou.
                atendidaPor: 'humano',
            },
            select: { id: true },
        })

    // ── a ligação, quando foi uma ──
    if (mode === 'call') {
        const now = new Date()
        await prisma.activity.create({
            data: {
                workspaceId,
                userId,
                contactId: contact.id,
                dealId: deal.id,
                type: 'call',
                title: `Ligação — ${name || canonical}`,
                description: callNotes || undefined,
                dueDate: now,
                completedAt: now,
            },
        })
        // A nota interna existe para o fio não abrir vazio: quem abrir esta
        // conversa amanhã precisa ler o que foi falado sem ir à Agenda. A
        // atividade guarda o registro estruturado; a nota, o relato no lugar
        // onde se lê a conversa.
        await prisma.message.create({
            data: {
                conversationId: conversation.id,
                direction: 'internal',
                content: callNotes ? `Ligação recebida. ${callNotes}` : 'Ligação recebida.',
                contentType: 'text',
                sentBy: userId,
                isInternal: true,
                status: 'sent',
            },
        })
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: now },
        })
    }

    if (ehNovo) await contatoCriado(workspaceId, contact.id)

    return NextResponse.json({
        conversationId: conversation.id,
        contactId: contact.id,
        dealId: deal.id,
        mode,
    }, { status: 201 })
}
