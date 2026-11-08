import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { canBroadcast } from '@/lib/limits'
import { congelarDestinatarios, iniciarDisparo } from '@/trabalhos/servicos/broadcast'
import { whereDeDestinatarios } from '@/lib/marketing/lists'
import { ehCanalDeCampanha, type CanalDeCampanha } from '@/lib/marketing/apresentacao'

/** Por que a lista ficou vazia — e a resposta muda com o canal. */
function semDestinatarios(canal: CanalDeCampanha): string {
    return canal === 'email'
        ? 'As listas não têm ninguém com e-mail cadastrado que não tenha cancelado a inscrição.'
        : 'As listas não têm ninguém com telefone válido que não tenha pedido para parar.'
}

const sendSchema = z.object({
    /** ISO. Ausente ou no passado = dispara agora. */
    scheduledAt: z.string().datetime().optional(),
})

/**
 * Quantos contatos distintos as listas da campanha alcançam, pelo canal dela.
 *
 * Usa `whereDeDestinatarios`, o **mesmo** predicado de `congelarDestinatarios`.
 * Escrito aqui de novo, ele divergiria — e o teto do plano seria conferido
 * contra um número e a campanha sairia com outro.
 */
async function estimarDestinatarios(
    workspaceId: string,
    broadcastId: string,
    canal: CanalDeCampanha
): Promise<number> {
    const listas = await prisma.broadcastList.findMany({
        where: { broadcastId },
        select: { listId: true },
    })
    const listIds = listas.map((l) => l.listId)
    if (listIds.length === 0) return 0
    return prisma.contact.count({ where: whereDeDestinatarios(workspaceId, canal, listIds) })
}

/**
 * O portão do canal, conferido **no disparo** e não só na criação.
 *
 * O rascunho pode ter ficado dias parado: o DKIM do remetente pode ter sido
 * removido da zona do cliente, a linha oficial pode ter caído. Conferir só na
 * criação deixaria o fan-out descobrir isso destinatário a destinatário,
 * marcando a campanha inteira como falha em vez de recusar antes de começar.
 */
function portaoDoCanal(b: {
    channel: string
    sender: { status: string; domain: string } | null
    integrationId: string | null
}): string | null {
    if (b.channel === 'email') {
        if (!b.sender) return 'A campanha não tem remetente de e-mail.'
        if (b.sender.status !== 'verified') {
            return `O domínio ${b.sender.domain} não está verificado. Publique os três registros de DNS antes de disparar.`
        }
        return null
    }
    if (!b.integrationId) return 'A campanha não tem linha de envio.'
    return null
}

// POST — dispara agora ou agenda. Congela os destinatários, confere o teto do
// plano e enfileira (imediato) ou deixa para o cron (agendado).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const { id } = await params
    const broadcast = await prisma.broadcast.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: {
            id: true,
            status: true,
            channel: true,
            integrationId: true,
            sender: { select: { status: true, domain: true } },
        },
    })
    if (!broadcast) return new NextResponse('Campanha não encontrada', { status: 404 })
    if (broadcast.status !== 'draft') {
        return NextResponse.json(
            { error: 'Só uma campanha em rascunho pode ser disparada ou agendada.' },
            { status: 400 }
        )
    }

    const bloqueio = portaoDoCanal(broadcast)
    if (bloqueio) return NextResponse.json({ error: bloqueio }, { status: 400 })

    const canal: CanalDeCampanha = ehCanalDeCampanha(broadcast.channel)
        ? broadcast.channel
        : 'whatsapp'

    const { scheduledAt } = sendSchema.parse(await request.json().catch(() => ({})))
    const quando = scheduledAt ? new Date(scheduledAt) : null
    const agendarParaFuturo = quando !== null && quando.getTime() > Date.now()

    // Teto do plano, antes de qualquer escrita de destinatário.
    const estimativa = await estimarDestinatarios(member.workspaceId, id, canal)
    if (estimativa === 0) {
        return NextResponse.json(
            { error: semDestinatarios(canal) },
            { status: 400 }
        )
    }
    const permitido = await canBroadcast(member.workspaceId, estimativa)
    if (!permitido.ok) {
        return NextResponse.json({ error: permitido.error }, { status: permitido.status })
    }

    if (agendarParaFuturo) {
        // Agendada: o cron congela e dispara na hora. A lista fica atual.
        await prisma.broadcast.update({
            where: { id },
            data: { status: 'scheduled', scheduledAt: quando },
        })
        return NextResponse.json({ id, status: 'scheduled', scheduledAt: quando })
    }

    // Imediata: congela agora e enfileira o fan-out.
    const total = await congelarDestinatarios(id)
    if (total === 0) {
        return NextResponse.json(
            { error: semDestinatarios(canal) },
            { status: 400 }
        )
    }
    await iniciarDisparo(id)
    return NextResponse.json({ id, status: 'running', totalCount: total })
}
