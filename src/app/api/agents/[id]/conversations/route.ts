import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { readAgent } from '@/lib/auth/agent'
import { conversationScope } from '@/lib/auth/workspace'

/** Teto de linhas: a tela é um histórico de leitura, não um relatório. */
const LIMIT = 200

/**
 * As conversas que passaram por este agente.
 *
 * A tela de histórico existia com a lista vazia por construção — nada a
 * preenchia. Aqui ela recebe o que o banco já guardava: a conversa, o paciente
 * do outro lado, quantas mensagens trocaram e quando foi a última.
 *
 * `_count` em vez de carregar as mensagens: a contagem é a única coisa que a
 * tela mostra, e um agente com meses de uso traria milhares de linhas para
 * somar no cliente.
 *
 * O ESCOPO NÃO PODE VIR DO AGENTE
 *
 * Isto filtrava só por `agentId`, e era seguro **por construção**: as conversas
 * de um agente estavam sempre no workspace dele, então o id do agente implicava
 * a clínica. A movimentação de agentes entre unidades, de 2026-10-18, quebrou a
 * invariante — o agente movido mantém as conversas antigas na unidade de origem,
 * de propósito, porque elas pertencem aos pacientes de lá. A partir dali, esta
 * consulta listaria para a clínica de destino o histórico da clínica de origem:
 * nome do paciente, telefone, canal, contagem e datas.
 *
 * Agora o escopo é o de sempre — a unidade da sessão mais o recorte de
 * departamento —, o mesmo que a lista de conversas usa. Duas consequências
 * desejadas: o histórico mostra o que **esta** clínica atendeu com este agente,
 * e o atendente de um departamento não vê a fila dos outros por esta porta.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const auth = await readAgent(agentId)
        if (!auth.ok) return auth.response

        const conversations = await prisma.conversation.findMany({
            where: {
                agentId,
                workspaceId: auth.member.workspaceId,
                ...conversationScope(auth.member),
            },
            orderBy: { lastMessageAt: 'desc' },
            take: LIMIT,
            select: {
                id: true,
                channel: true,
                status: true,
                lastMessageAt: true,
                createdAt: true,
                contact: { select: { name: true, phone: true } },
                _count: { select: { messages: true } },
            },
        })

        return NextResponse.json(
            conversations.map((c) => ({
                id: c.id,
                contactName: c.contact?.name || c.contact?.phone || null,
                channel: c.channel,
                status: c.status,
                messageCount: c._count.messages,
                lastMessageAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
                createdAt: c.createdAt.toISOString(),
            }))
        )
    } catch (error) {
        console.error('[AGENT_CONVERSATIONS_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
