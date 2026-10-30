import { NextRequest, NextResponse } from 'next/server'
import { dentroDoLimite, ipDaRequisicao } from '@/lib/limite'
import prisma from '@/lib/prisma'
import { getBillingState } from '@/lib/billing'
import { QUEUE } from '@/lib/queue/definitions'
import { entregar } from '@/lib/queue/entregar'
import {
    TETO_DE_MENSAGENS_DO_VISITANTE,
    novaChave,
    widgetCors,
    widgetIntegration,
} from '@/lib/widget'
import { isHumanHandled } from '@/trabalhos/servicos/conversation'

/**
 * A conversa do visitante do site.
 *
 * `GET` devolve o que já foi dito **naquela** conversa — identificada pela chave
 * do visitante, que só existe no navegador dele. `POST` grava o que ele
 * escreveu e aciona o agente.
 *
 * Não há sessão nem login: é um site aberto. O que impede abuso é o teto por
 * conversa (ver `TETO_DE_MENSAGENS_DO_VISITANTE`) e o fato de a chave pública
 * não dar acesso a nada além de começar a falar.
 */

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: widgetCors() })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
    const { key } = await params
    const cors = widgetCors()
    const integracao = await widgetIntegration(key)
    if (!integracao) return NextResponse.json({ error: 'Widget não encontrado' }, { status: 404, headers: cors })

    const visitante = new URL(request.url).searchParams.get('visitor') ?? ''
    if (!visitante) return NextResponse.json({ messages: [] }, { headers: cors })

    const conversa = await prisma.conversation.findFirst({
        where: {
            workspaceId: integracao.agent.workspaceId,
            visitorKey: visitante,
            channel: 'web',
        },
        select: { id: true },
    })
    if (!conversa) return NextResponse.json({ messages: [] }, { headers: cors })

    const mensagens = await prisma.message.findMany({
        where: {
            conversationId: conversa.id,
            // Nota interna é conversa da equipe sobre o visitante; ele não vê.
            isInternal: false,
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: { id: true, direction: true, content: true, createdAt: true },
    })

    return NextResponse.json(
        {
            messages: mensagens.map((m) => ({
                id: m.id,
                // "eu" e "clínica": o visitante não precisa saber se quem
                // respondeu foi o agente ou uma pessoa.
                from: m.direction === 'inbound' ? 'visitor' : 'clinic',
                content: m.content,
                at: m.createdAt,
            })),
        },
        { headers: cors }
    )
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
    const { key } = await params
    const cors = widgetCors()
    const integracao = await widgetIntegration(key)
    if (!integracao) return NextResponse.json({ error: 'Widget não encontrado' }, { status: 404, headers: cors })

    const body = (await request.json().catch(() => ({}))) as {
        visitor?: string
        content?: string
        name?: string
    }
    const texto = typeof body.content === 'string' ? body.content.trim().slice(0, 2000) : ''
    if (!texto) return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400, headers: cors })

    const { agent } = integracao
    const workspaceId = agent.workspaceId

    // Avaliação vencida: a conversa continua chegando e a equipe lê; o que para
    // é o agente responder. Mesma regra do WhatsApp — ver PRODUCT.md §3.
    const billing = await getBillingState(workspaceId)

    /**
     * A chave do visitante é dele; se não vier, nasce uma.
     *
     * Devolvida no corpo para o navegador guardar. É assim que a segunda
     * mensagem cai na mesma conversa da primeira.
     */
    const visitante = body.visitor && body.visitor.length >= 16 ? body.visitor : novaChave('v')

    let conversa = await prisma.conversation.findFirst({
        where: { workspaceId, visitorKey: visitante, channel: 'web' },
        select: { id: true, assignedTo: true, handoffAt: true },
    })

    /**
     * **Abrir conversa nova é o ato caro, e era ilimitado.**
     *
     * A chave do visitante vem do corpo, e é o cliente quem a escolhe: mandar
     * uma `visitor` nova a cada requisição criava contato + conversa +
     * mensagem + job de resposta da IA, sem teto. O único limite existente era
     * `TETO_DE_MENSAGENS_DO_VISITANTE`, que conta **por conversa** — e por isso
     * não via nada: cada requisição abria uma conversa diferente.
     *
     * O que isso custa não é incômodo: é **crédito de IA da clínica**, que é
     * dinheiro (`lib/llm/usage-tracker.ts` cobra cada ida ao modelo), e
     * CU-hora do Neon, cuja franquia é de 100/mês. De um anônimo, com CORS `*`.
     *
     * Dois tetos, porque um só não serve:
     *
     * - **por IP**, apertado — é o que para o laço de um navegador só;
     * - **por widget**, folgado — é o que limita o estrago de um ataque
     *   distribuído, em que cada IP manda pouco.
     *
     * Os números são para um site de clínica: dez conversas novas por hora do
     * mesmo IP já é muito, e cem por hora no widget inteiro é mais do que
     * qualquer clínica atendida por uma recepção consegue absorver. Mensagem
     * em conversa **existente** não passa por aqui — quem já está falando
     * continua falando, e o teto por conversa segue valendo.
     */
    if (!conversa) {
        const ip = ipDaRequisicao(request)
        const [ipOk, widgetOk] = await Promise.all([
            dentroDoLimite(`widget:nova:${key}:${ip}`, 10, 3600),
            dentroDoLimite(`widget:nova:${key}`, 100, 3600),
        ])

        if (!ipOk || !widgetOk) {
            console.warn(
                `[WIDGET] teto de conversas novas atingido — widget=${key} ip=${ip} ` +
                    `(porIp=${ipOk ? 'ok' : 'estourou'} porWidget=${widgetOk ? 'ok' : 'estourou'})`
            )
            return NextResponse.json(
                { error: 'Muitas conversas iniciadas. Tente de novo em alguns minutos.' },
                { status: 429, headers: cors }
            )
        }
    }

    if (!conversa) {
        /**
         * Um visitante do site não tem telefone nem nome, e isso é o normal.
         *
         * **Nome fica nulo de propósito.** Batizá-lo de "Visitante do site" fazia
         * o agente responder "Oi, Visitante!" — medido numa conversa de prova,
         * e soa como formulário falando. Nulo, o prompt diz ao agente que ele
         * ainda não sabe o nome e que pergunte com naturalidade, que é o que
         * uma recepção faria.
         */
        const contato = await prisma.contact.create({
            data: {
                workspaceId,
                name: body.name?.trim().slice(0, 80) || null,
                // O visitante escreveu primeiro — é isso que `inbound` diz. De
                // onde ele veio, o navegador não conta: quem sabe é a linha,
                // quando a clínica disse a ela qual anúncio aponta para o site.
                createdVia: 'inbound',
                originId: integracao.defaultOriginId,
            },
        })
        conversa = await prisma.conversation.create({
            data: {
                workspaceId,
                contactId: contato.id,
                agentId: agent.id,
                channel: 'web',
                visitorKey: visitante,
                status: 'active',
            },
            select: { id: true, assignedTo: true, handoffAt: true },
        })
    }

    const jaDitas = await prisma.message.count({
        where: { conversationId: conversa.id, direction: 'inbound' },
    })

    await prisma.message.create({
        data: {
            conversationId: conversa.id,
            direction: 'inbound',
            content: texto,
            contentType: 'text',
            sentBy: 'user',
            status: 'sent',
        },
    })
    await prisma.conversation.update({
        where: { id: conversa.id },
        data: { lastMessageAt: new Date() },
    })

    /**
     * Quando o agente **não** é acionado, e por quê.
     *
     * Em todos estes casos a mensagem fica gravada e a equipe a vê na caixa de
     * entrada; o que não acontece é a resposta automática.
     */
    const cala =
        !agent.isActive ? 'agente pausado'
        : isHumanHandled(conversa) ? 'conversa com a equipe'
        : billing.readOnly ? 'workspace sem crédito'
        : jaDitas >= TETO_DE_MENSAGENS_DO_VISITANTE ? 'teto de mensagens do visitante'
        : null

    if (!cala) {
        await entregar(
            QUEUE.AI_REPLY,
            {
                conversationId: conversa.id,
                agentId: agent.id,
                workspaceId,
                // Sem canal de saída: a resposta fica na conversa e este widget
                // vem buscá-la. Ver `enqueueOutboundText`.
                integrationId: null,
                to: '',
            },
            {
                nome: 'reply',
                // Um job por conversa em voo: enquanto a resposta não sai, outra
                // mensagem do visitante não abre uma segunda geração em paralelo.
                jobId: `web-${conversa.id}-${Date.now()}`,
                // Eram 1 500 ms. O Queues só aceita segundos inteiros, e aqui o
                // arredondamento é para cima de propósito: meio segundo a mais
                // de espera é invisível; meio segundo a menos encurta a janela
                // em que o visitante ainda está digitando.
                atrasoSegundos: 2,
            }
        )
    }

    return NextResponse.json(
        { visitor: visitante, replying: !cala },
        { headers: cors }
    )
}

export const dynamic = 'force-dynamic'
