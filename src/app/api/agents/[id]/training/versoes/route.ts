import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { manageAgent } from '@venn/core/lib/auth/agent'
import { acharDocumento } from '@venn/core/lib/treinamento/documentos'
import {
    rascunhosDaRestauracao,
    type DocumentoComRascunho,
    type DocumentoNoInstantaneo,
} from '@venn/core/lib/treinamento/versao'

/**
 * O histórico de publicações, e a volta atrás.
 *
 * `GET` lista as versões sem o instantâneo: o conteúdo dos sete documentos pode
 * ter 350 mil caracteres, e a tela só precisa do número, da data, de quem
 * publicou e de quais slugs mudaram.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const versoes = await prisma.agentTrainingVersion.findMany({
            where: { agentId },
            orderBy: { version: 'desc' },
            take: 50,
            select: {
                version: true,
                changed: true,
                note: true,
                publishedBy: true,
                createdAt: true,
            },
        })

        return NextResponse.json({ versoes })
    } catch (error) {
        console.error('[TRAINING_VERSOES_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

/**
 * Restaura uma versão — **como rascunho**, nunca direto para o ar.
 *
 * Desfazer é uma proposta como qualquer outra: quem voltou olha, mede e publica.
 * Restaurar direto no `content` faria a volta atrás ser a única mudança de
 * treinamento que entra sem número, que é exatamente o que o princípio 5 do
 * estudo proíbe. E seria a mudança mais perigosa a entrar sem medição, porque
 * quem desfaz está com pressa.
 *
 * O efeito na tela é o esperado: os campos passam a mostrar o texto antigo, com
 * o aviso de "há mudanças não publicadas" e o botão Publicar aceso.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const corpo = z.object({ versao: z.number().int().min(1) }).parse(await request.json())

        const alvo = await prisma.agentTrainingVersion.findUnique({
            where: { agentId_version: { agentId, version: corpo.versao } },
            select: { docs: true },
        })
        if (!alvo) return NextResponse.json({ error: 'Versão não encontrada' }, { status: 404 })

        /**
         * O instantâneo vem de um campo `Json`, então a forma dele é verificada
         * aqui e não confiada.
         *
         * É dado nosso, gravado por esta mesma aplicação — mas um `Json` que
         * mudou de forma entre versões do código viraria `undefined` em
         * `d.content` e gravaria rascunho vazio, apagando o trabalho de quem
         * mandou restaurar. Recusar é melhor.
         */
        const instantaneo: DocumentoNoInstantaneo[] = Array.isArray(alvo.docs)
            ? (alvo.docs as unknown[]).filter(
                  (d): d is DocumentoNoInstantaneo =>
                      typeof d === 'object' &&
                      d !== null &&
                      typeof (d as DocumentoNoInstantaneo).slug === 'string' &&
                      typeof (d as DocumentoNoInstantaneo).content === 'string' &&
                      acharDocumento((d as DocumentoNoInstantaneo).slug) !== undefined
              )
            : []

        if (instantaneo.length === 0) {
            return NextResponse.json(
                { error: 'O instantâneo desta versão está ilegível; nada foi alterado.' },
                { status: 422 }
            )
        }

        const gravados = await prisma.agentTrainingDoc.findMany({
            where: { agentId },
            select: { slug: true, content: true, draftContent: true },
        })
        const atuais: DocumentoComRascunho[] = gravados.map((d) => ({
            slug: d.slug,
            content: d.content,
            draftContent: d.draftContent,
        }))

        const rascunhos = rascunhosDaRestauracao(instantaneo, atuais)

        if (rascunhos.length === 0) {
            return NextResponse.json({
                restaurado: true,
                versao: corpo.versao,
                slugs: [],
                aviso: 'Esta versão é idêntica ao que já está no ar.',
            })
        }

        await prisma.$transaction(
            rascunhos.map((r) =>
                prisma.agentTrainingDoc.upsert({
                    where: { agentId_slug: { agentId, slug: r.slug } },
                    create: { agentId, slug: r.slug, content: '', draftContent: r.draftContent },
                    update: { draftContent: r.draftContent },
                })
            )
        )

        return NextResponse.json({
            restaurado: true,
            versao: corpo.versao,
            slugs: rascunhos.map((r) => r.slug),
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message ?? 'inválido' }, { status: 400 })
        }
        console.error('[TRAINING_VERSOES_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
