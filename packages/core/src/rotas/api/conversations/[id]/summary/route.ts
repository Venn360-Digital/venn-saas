import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { conversationScope, getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { LLMFactory } from '@venn/core/lib/llm/factory'
import { checkCredits, spendAiCredits, trackUsage } from '@venn/core/lib/llm/usage-tracker'
import { diaNoFuso, inicioDoDiaUtc } from '@venn/core/lib/fuso'
import { fusoDaUnidade } from '@venn/core/lib/fuso-da-unidade'
import {
    JANELA_DO_RESUMO,
    MODELO_DO_RESUMO,
    systemDoResumo,
    transcrever,
} from '@venn/core/lib/conversas/resumo'

/** Barato de propósito: resumir não precisa do modelo caro. */
/**
 * As constantes e o prompt vêm de `lib/conversas/resumo.ts`, **um só para os dois
 * chamadores**: esta rota e a compactação automática do processador.
 *
 * Eram declaradas aqui. Duas cópias divergiriam na primeira vez que alguém
 * melhorasse uma delas, e aí o resumo que a tela mostra e o que o agente lê
 * passariam a descrever a mesma conversa de formas diferentes — sem ninguém
 * notar, porque ninguém olha os dois lado a lado.
 */

/**
 * O resumo da conversa, lido e gerado.
 *
 * GET devolve o que está guardado e nunca cobra — abrir o painel é de graça.
 * POST gera, debita o crédito e guarda. Essa separação é o ponto: a versão em
 * que abrir o painel chamava o modelo cobraria da clínica cada vez que alguém
 * clicasse no ícone por curiosidade.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const conversation = await prisma.conversation.findFirst({
        where: { id, workspaceId: auth.member.workspaceId, ...conversationScope(auth.member) },
        select: { contactId: true, summaryText: true, summaryAt: true, summaryUntilId: true },
    })
    if (!conversation) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })

    return NextResponse.json({
        summary: conversation.summaryText,
        generatedAt: conversation.summaryAt,
        newMessages: await countSince(id, conversation.summaryUntilId),
        appointments: await upcomingFor(auth.member.workspaceId, conversation.contactId),
    })
}

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const conversation = await prisma.conversation.findFirst({
        where: { id, workspaceId: auth.member.workspaceId, ...conversationScope(auth.member) },
        select: { contactId: true },
    })
    if (!conversation) {
        return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    // O crédito é verificado antes da chamada: estourar depois de gastar o
    // token seria cobrar por um resumo que o cliente não pediu.
    const credits = await checkCredits(auth.member.workspaceId)
    if (!credits.hasCredits) {
        return NextResponse.json(
            { error: 'Sem créditos de IA. Compre créditos em Plano e créditos para gerar o resumo.' },
            { status: 402 }
        )
    }

    const appointments = await upcomingFor(auth.member.workspaceId, conversation.contactId)

    const recent = await prisma.message.findMany({
        where: { conversationId: id, isInternal: false },
        orderBy: { createdAt: 'desc' },
        take: JANELA_DO_RESUMO,
        select: { id: true, direction: true, content: true, transcript: true, contentType: true, createdAt: true },
    })
    if (recent.length === 0) {
        return NextResponse.json({ error: 'A conversa ainda não tem mensagens para resumir' }, { status: 400 })
    }

    const chronological = [...recent].reverse()
    const transcriptText = transcrever(chronological)

    try {
        // Os agendamentos entram no prompt como fato, não para o modelo
        // repeti-los: é o que impede "Pendências: marcar a consulta" quando a
        // consulta já está marcada na Agenda.
        const agenda = appointments.length
            ? appointments
                .map((a) => `${a.dueDate.slice(0, 10)}${a.startTime ? ` ${a.startTime}` : ''} — ${a.title}`)
                .join('; ')
            : 'nenhum'

        const llm = LLMFactory.create('openai', { model: MODELO_DO_RESUMO, temperature: 0.2, maxTokens: 600 })
        const result = await llm.generate([
            { role: 'system', content: systemDoResumo() },
            { role: 'user', content: `Agendamentos já marcados na Agenda: ${agenda}.\n\n${transcriptText}` },
        ])

        await trackUsage('openai', MODELO_DO_RESUMO, result.usage, {
            workspaceId: auth.member.workspaceId,
            metadata: { kind: 'conversation_summary', conversationId: id },
        })

        // Uma ação de IA entregue, um crédito — ver `spendAiCredits`. O resumo
        // conta como ação porque a carteira não pode ter consumidor invisível:
        // ele passa pelo `checkCredits` lá acima e tem de passar pelo débito
        // também, senão o saldo que barra o agente nunca desce por causa dele.
        await spendAiCredits(auth.member.workspaceId, 1, 'resumo de conversa')

        const lastId = chronological[chronological.length - 1].id
        const generatedAt = new Date()
        await prisma.conversation.update({
            where: { id },
            data: { summaryText: result.content, summaryAt: generatedAt, summaryUntilId: lastId },
        })

        return NextResponse.json({
            summary: result.content,
            generatedAt,
            newMessages: 0,
            appointments,
            messagesRead: chronological.length,
        })
    } catch (error) {
        console.error('[CONVERSATION_SUMMARY] falhou:', error)
        return NextResponse.json({ error: 'Não foi possível gerar o resumo agora' }, { status: 502 })
    }
}

/** Quantas mensagens chegaram depois da última que o resumo leu. */
async function countSince(conversationId: string, untilId: string | null): Promise<number> {
    if (!untilId) return 0
    const until = await prisma.message.findUnique({
        where: { id: untilId },
        select: { createdAt: true },
    })
    if (!until) return 0
    return prisma.message.count({
        where: { conversationId, isInternal: false, createdAt: { gt: until.createdAt } },
    })
}

/**
 * As atividades futuras deste paciente.
 *
 * Fora do texto gerado de propósito: o resumo é uma fotografia do dia em que
 * foi gerado, e "tem consulta marcada" muda depois disso — uma frase
 * congelada diria que há consulta uma semana depois de ela ter acontecido.
 * Vindo do banco em toda leitura, o painel responde "tem agendamento?" com o
 * que a Agenda tem agora, e sem gastar crédito.
 */
async function upcomingFor(workspaceId: string, contactId: string) {
    // `dueDate` é data sem hora: fronteira em meia-noite UTC do dia da clínica.
    const today = inicioDoDiaUtc(diaNoFuso(new Date(), await fusoDaUnidade(workspaceId)))

    const activities = await prisma.activity.findMany({
        where: {
            workspaceId,
            contactId,
            completedAt: null,
            dueDate: { gte: today },
        },
        orderBy: [{ dueDate: 'asc' }, { startTime: 'asc' }],
        take: 5,
        select: { id: true, title: true, type: true, dueDate: true, startTime: true },
    })

    return activities.map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        dueDate: (a.dueDate ?? today).toISOString(),
        startTime: a.startTime,
    }))
}
