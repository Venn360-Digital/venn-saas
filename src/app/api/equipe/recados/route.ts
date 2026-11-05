import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'
import { transmitir } from '@/trabalhos/tempo-real'

/**
 * Os recados da equipe: ler a caixa, e mandar um.
 *
 * ## O que esta rota NÃO é
 *
 * Não é conversa de atendimento. Não cria `Conversation`, não toca em contato,
 * não entra no histórico do paciente e não consome crédito de IA. É o "o
 * paciente do 14h remarcou" que hoje acontece no WhatsApp pessoal de cada um —
 * fora do sistema, fora de qualquer registro, e sem o contexto da tela em que a
 * pessoa está trabalhando.
 *
 * ## Dois caminhos, de propósito
 *
 * **Grava** em `team_messages` e **transmite** pelo canal efêmero. Nem um nem
 * outro sozinho resolve: só o tempo real perderia o recado de quem está
 * offline, e só o banco faria o aviso chegar na próxima navegação — que, para
 * quem está com a tela de conversas aberta o dia inteiro, é daqui a horas.
 *
 * A transmissão é `paraUsuario`: o recado é de uma pessoa para outra, e mandá-lo
 * para a sala inteira entregaria a todos o texto que era de um. O evento leva
 * **só identificadores**, como todo o resto do tempo real; o texto vem por esta
 * rota, onde a autorização acontece.
 */

/** O teto do corpo. Recado é recado — o que não cabe aqui vira conversa. */
const TETO = 2_000

export async function GET(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { workspaceId, userId } = auth.member
    const com = request.nextUrl.searchParams.get('com')

    /**
     * Com `?com=`, a conversa com aquela pessoa — os dois sentidos, em ordem.
     * Sem, a caixa de entrada: o que chegou para mim.
     *
     * `workspaceId` nos dois, sempre: numa conta Multiclínica a mesma pessoa
     * existe em duas unidades, e o recado é da unidade onde foi escrito.
     */
    const where = com
        ? {
              workspaceId,
              OR: [
                  { fromUserId: userId, toUserId: com },
                  { fromUserId: com, toUserId: userId },
              ],
          }
        : { workspaceId, toUserId: userId }

    const recados = await prisma.teamMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
            id: true,
            body: true,
            createdAt: true,
            readAt: true,
            fromUserId: true,
            toUserId: true,
            from: { select: { name: true, lastName: true, avatar: true } },
        },
    })

    const naoLidos = await prisma.teamMessage.count({
        where: { workspaceId, toUserId: userId, readAt: null },
    })

    return NextResponse.json({
        // Devolvidos do mais antigo para o mais novo: é a ordem em que se lê
        // uma conversa. A consulta desce por `createdAt` para que o `take: 50`
        // pegue os ÚLTIMOS cinquenta, e não os primeiros.
        recados: recados.reverse().map((r) => ({
            id: r.id,
            body: r.body,
            createdAt: r.createdAt,
            lido: r.readAt !== null,
            meu: r.fromUserId === userId,
            deUserId: r.fromUserId,
            deNome: [r.from.name, r.from.lastName].filter(Boolean).join(' ') || 'Sem nome',
            deAvatar: r.from.avatar,
        })),
        naoLidos,
    })
}

export async function POST(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { workspaceId, userId } = auth.member
    const corpo = (await request.json().catch(() => null)) as {
        para?: unknown
        texto?: unknown
    } | null

    const para = typeof corpo?.para === 'string' ? corpo.para : ''
    const texto = typeof corpo?.texto === 'string' ? corpo.texto.trim() : ''

    if (!para || !texto) {
        return NextResponse.json({ error: 'Informe o destinatário e o texto' }, { status: 400 })
    }
    if (texto.length > TETO) {
        return NextResponse.json(
            { error: `O recado passa de ${TETO.toLocaleString('pt-BR')} caracteres` },
            { status: 400 }
        )
    }
    if (para === userId) {
        return NextResponse.json({ error: 'Não dá para mandar recado para si' }, { status: 400 })
    }

    /**
     * O destinatário tem de ser da **mesma unidade**, e ativo.
     *
     * Sem esta conferência, o `para` do corpo seria o id de qualquer usuário do
     * banco — inclusive de outra clínica. É a mesma classe de furo que o
     * `conversationScope` fecha nas outras rotas: id que vem do cliente nunca é
     * autorização.
     */
    const destinatario = await prisma.workspaceUser.findFirst({
        where: { workspaceId, userId: para, isActive: true },
        select: { userId: true },
    })
    if (!destinatario) {
        return NextResponse.json({ error: 'Pessoa não encontrada nesta unidade' }, { status: 404 })
    }

    const recado = await prisma.teamMessage.create({
        data: { workspaceId, fromUserId: userId, toUserId: para, body: texto },
        select: { id: true, createdAt: true },
    })

    /**
     * Pelo caminho EFÊMERO, e não pelo outbox.
     *
     * O outbox garante a entrega ao custo de uma gravação e da varredura de
     * cada minuto — e um recado que aparece um minuto depois já foi dito em voz
     * alta do outro lado da recepção. Perder o evento não perde o recado: ele
     * está gravado, e a próxima abertura do painel o traz. Ver
     * `src/trabalhos/tempo-real.ts`.
     */
    await transmitir({
        workspaceId,
        tipo: 'recado',
        dados: { recadoId: recado.id, deUserId: userId },
        paraUsuario: para,
    })

    return NextResponse.json({ ok: true, id: recado.id, createdAt: recado.createdAt })
}

/**
 * Marcar como lido — a caixa inteira, ou só o que veio de uma pessoa.
 *
 * `updateMany` com `readAt: null` no filtro: sem isso, reabrir o painel
 * reescreveria a data de leitura de recados antigos a cada vez, e "lido às
 * 14:06" passaria a dizer a hora da última vez que alguém olhou.
 */
export async function PATCH(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { workspaceId, userId } = auth.member
    const corpo = (await request.json().catch(() => null)) as { de?: unknown } | null
    const de = typeof corpo?.de === 'string' ? corpo.de : null

    const { count } = await prisma.teamMessage.updateMany({
        where: {
            workspaceId,
            toUserId: userId,
            readAt: null,
            ...(de ? { fromUserId: de } : {}),
        },
        data: { readAt: new Date() },
    })

    return NextResponse.json({ ok: true, marcados: count })
}
