import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { manageAgent } from '@/lib/auth/agent'
import { acharDocumento } from '@/lib/treinamento/documentos'
import { somarAoDocumento } from '@/lib/lacunas/rascunho'

/**
 * A fila de aprovação das lacunas.
 *
 * ## O que aprovar faz, e o que NÃO faz
 *
 * Aprovar junta o texto proposto ao **rascunho** do documento de destino. Não
 * publica. A sugestão aprovada ainda passa por Publicar, que é onde a versão
 * nasce e onde a medição acontece — então nenhuma sugestão automática alcança o
 * agente sem uma pessoa olhar duas vezes.
 *
 * E o texto proposto tem a resposta **em branco**, num comentário de HTML. O
 * instrutor aprova a pergunta, escreve a resposta e publica. Se ele aprovar e
 * não escrever, `semComentarios` descarta o marcador antes de o texto ir para o
 * acervo: o agente recebe nada em vez de uma resposta inventada, e a pergunta
 * volta a aparecer como lacuna na semana seguinte.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const [sugestoes, naoAgrupadas] = await Promise.all([
            prisma.gapSuggestion.findMany({
                where: { agentId },
                orderBy: [{ status: 'asc' }, { demand: 'desc' }, { createdAt: 'desc' }],
                take: 100,
                select: {
                    id: true,
                    question: true,
                    demand: true,
                    targetSlug: true,
                    draftText: true,
                    status: true,
                    decidedAt: true,
                    createdAt: true,
                },
            }),
            /**
             * Quantas lacunas ainda não foram agrupadas.
             *
             * A tela mostra porque é a diferença entre "nada aconteceu" e "a
             * mineração ainda não rodou" — e a mineração roda uma vez por semana,
             * então essa distinção vale dias.
             */
            prisma.knowledgeGap.count({ where: { agentId, suggestionId: null } }),
        ])

        return NextResponse.json({
            naoAgrupadas,
            sugestoes: sugestoes.map((s) => ({
                ...s,
                tituloDoAlvo: acharDocumento(s.targetSlug)?.titulo ?? s.targetSlug,
            })),
        })
    } catch (error) {
        console.error('[LACUNAS_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const corpo = z
            .object({
                sugestao: z.string().min(1),
                decisao: z.enum(['aprovar', 'descartar']),
            })
            .parse(await request.json())

        const sugestao = await prisma.gapSuggestion.findFirst({
            // O agente no filtro: id de sugestão de outra clínica não decide
            // nada, em vez de decidir a dela.
            where: { id: corpo.sugestao, agentId },
            select: { id: true, status: true, targetSlug: true, draftText: true },
        })
        if (!sugestao) return NextResponse.json({ error: 'Sugestão não encontrada' }, { status: 404 })

        if (sugestao.status !== 'nova') {
            return NextResponse.json(
                { error: `Esta sugestão já foi ${sugestao.status}.` },
                { status: 409 }
            )
        }

        if (corpo.decisao === 'descartar') {
            await prisma.gapSuggestion.update({
                where: { id: sugestao.id },
                data: { status: 'descartada', decidedBy: auth.member.userId, decidedAt: new Date() },
            })
            /**
             * Descartar **não** apaga as lacunas, e isto é deliberado.
             *
             * Elas são o registro do que o agente não soube. O que a próxima
             * mineração não deve fazer é propor a mesma coisa de novo, então elas
             * ficam marcadas como `descartada` — agrupadas, decididas, fora da
             * fila, e ainda contáveis no Andar 3 da medição.
             */
            await prisma.knowledgeGap.updateMany({
                where: { suggestionId: sugestao.id },
                data: { status: 'descartada' },
            })
            return NextResponse.json({ decidido: 'descartada' })
        }

        const doc = acharDocumento(sugestao.targetSlug)
        if (!doc) {
            return NextResponse.json(
                { error: `O documento "${sugestao.targetSlug}" não existe mais no catálogo.` },
                { status: 422 }
            )
        }

        const atual = await prisma.agentTrainingDoc.findUnique({
            where: { agentId_slug: { agentId, slug: sugestao.targetSlug } },
            select: { content: true, draftContent: true },
        })

        /**
         * Junta ao **rascunho** se já houver um, senão ao que está no ar.
         *
         * Ignorar o rascunho existente apagaria o que alguém escreveu e não
         * publicou — e é justamente quem está trabalhando no documento que mais
         * provavelmente vai aprovar uma sugestão sobre ele.
         */
        const base = atual?.draftContent ?? atual?.content ?? ''
        const novo = somarAoDocumento(base, sugestao.draftText)

        if (novo.length > doc.teto) {
            return NextResponse.json(
                {
                    error:
                        `"${doc.titulo}" ficaria com ${novo.length.toLocaleString('pt-BR')} caracteres, ` +
                        `acima do teto de ${doc.teto.toLocaleString('pt-BR')}. ` +
                        'Publique ou enxugue o documento antes de aprovar.',
                },
                { status: 422 }
            )
        }

        await prisma.$transaction([
            prisma.agentTrainingDoc.upsert({
                where: { agentId_slug: { agentId, slug: sugestao.targetSlug } },
                create: { agentId, slug: sugestao.targetSlug, content: '', draftContent: novo },
                update: { draftContent: novo },
            }),
            prisma.gapSuggestion.update({
                where: { id: sugestao.id },
                data: { status: 'aprovada', decidedBy: auth.member.userId, decidedAt: new Date() },
            }),
            prisma.knowledgeGap.updateMany({
                where: { suggestionId: sugestao.id },
                data: { status: 'aprovada' },
            }),
        ])

        return NextResponse.json({
            decidido: 'aprovada',
            slug: sugestao.targetSlug,
            titulo: doc.titulo,
            /**
             * Dito na resposta porque é o que a tela precisa avisar: a sugestão
             * entrou como rascunho, e o agente só passa a vê-la depois de
             * Publicar — com a resposta escrita.
             */
            precisaPublicar: true,
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message ?? 'inválido' }, { status: 400 })
        }
        console.error('[LACUNAS_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
