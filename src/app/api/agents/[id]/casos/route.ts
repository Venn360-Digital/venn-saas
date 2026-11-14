import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { manageAgent } from '@venn/core/lib/auth/agent'
import type { Prisma } from '@venn/db'
import { ehHoldout } from '@venn/core/lib/avaliacao/pareado'

/**
 * O conjunto dourado: os casos guardados no console de ensaio.
 *
 * ## Por que esta é a única fonte
 *
 * A literatura descreve duas: o instrutor aprovando no ensaio, e o atendente
 * editando uma resposta sugerida antes de enviar. A segunda **não existe neste
 * produto** — o agente envia direto, sem passar por ninguém —, então entra só
 * quando houver sugestão de resposta ao atendente, se houver.
 *
 * ## Por que os trechos são guardados com o caso
 *
 * O juiz pergunta "a resposta se apoia nos trechos?". Se os trechos fossem
 * buscados na hora da avaliação, um caso de hoje seria julgado contra o material
 * de amanhã: a clínica reescreve Serviços, o trecho muda, e um caso que o
 * instrutor aprovou passa a reprovar sem que a resposta tenha mudado. O caso
 * tem de significar sempre a mesma coisa.
 */

const MAX_PERGUNTA = 2000
const MAX_REFERENCIA = 4000
const MAX_TRECHOS = 10

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        // `manageAgent` e não leitura: o que entra aqui vira critério de
        // aprovação do agente que fala com o paciente.
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const corpo = z
            .object({
                pergunta: z.string().trim().min(1).max(MAX_PERGUNTA),
                referencia: z.string().trim().min(1).max(MAX_REFERENCIA),
                trechos: z.array(z.string().max(4000)).max(MAX_TRECHOS).default([]),
                /**
                 * `aprovado` quando a resposta do agente estava boa; `corrigido`
                 * quando o instrutor reescreveu. A distinção não é cosmética: o
                 * caso corrigido é material de exemplo de estilo para o passo 6,
                 * o aprovado é só regressão.
                 */
                tipo: z.enum(['aprovado', 'corrigido']).default('aprovado'),
            })
            .parse(await request.json())

        const caso = await prisma.evaluationCase.create({
            data: {
                workspaceId: auth.member.workspaceId,
                agentId,
                question: corpo.pergunta,
                reference: corpo.referencia,
                chunks: corpo.trechos as unknown as Prisma.InputJsonValue,
                kind: corpo.tipo,
                createdBy: auth.member.userId,
            },
            select: { id: true, createdAt: true },
        })

        return NextResponse.json({
            guardado: true,
            id: caso.id,
            /**
             * Dito na resposta porque é informação que o instrutor merece ver.
             *
             * Um caso de holdout fica **fora** de toda afinação e só aparece na
             * conferência final. Esconder isso faria alguém guardar dez casos
             * sobre o mesmo assunto e estranhar que dois nunca aparecem no
             * relatório de ajuste.
             */
            holdout: ehHoldout(caso.id),
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message ?? 'inválido' }, { status: 400 })
        }
        console.error('[CASOS_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

/** Os casos guardados, do mais novo para o mais antigo. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const casos = await prisma.evaluationCase.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: { id: true, question: true, kind: true, createdAt: true },
        })

        return NextResponse.json({
            total: casos.length,
            casos: casos.map((c) => ({ ...c, holdout: ehHoldout(c.id) })),
        })
    } catch (error) {
        console.error('[CASOS_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const { searchParams } = new URL(request.url)
        const casoId = searchParams.get('caso')
        if (!casoId) return NextResponse.json({ error: 'caso obrigatório' }, { status: 400 })

        // `deleteMany` com o agente no filtro: um id de caso de outra clínica não
        // apaga nada, em vez de apagar o caso dela.
        const apagados = await prisma.evaluationCase.deleteMany({ where: { id: casoId, agentId } })

        return NextResponse.json({ apagados: apagados.count })
    } catch (error) {
        console.error('[CASOS_DELETE]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
