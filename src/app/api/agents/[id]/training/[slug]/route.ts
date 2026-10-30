import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { manageAgent } from '@/lib/auth/agent'
import { QUEUE } from '@/lib/queue/definitions'
import { entregar } from '@/lib/queue/entregar'
import { acharDocumento } from '@/lib/treinamento/documentos'
import { decidirIndexacao, TIPO_DE_TREINAMENTO, tituloDoAcervo } from '@/lib/treinamento/indexar'

/**
 * Grava um documento de treinamento e decide o que fazer com o acervo.
 *
 * Uma rota por documento, e não uma que grave os sete: cada seção da tela salva
 * o que ela edita, e salvar em bloco faria uma falha de um documento derrubar a
 * gravação dos outros seis.
 *
 * **O conteúdo não vai para a fila.** O job leva só a referência, e o
 * processador lê da tabela. O payload da fila tem teto de 128 KB e o documento
 * pode ter 200 mil caracteres — ver `src/lib/queue/tamanho.ts`, e ver que a rota
 * `/api/rag/index` ainda tem exatamente esse defeito para o caminho antigo.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; slug: string }> }
) {
    try {
        const { id: agentId, slug } = await params

        /**
         * O slug tem de estar no catálogo.
         *
         * Não é formalidade: o slug vira `title` em `knowledge_documents` e
         * chave de `upsert`. Slug inventado criaria documento que nenhuma tela
         * mostra e trechos que nenhuma reindexação substitui.
         */
        const doc = acharDocumento(slug)
        if (!doc) {
            return NextResponse.json({ error: 'documento de treinamento desconhecido' }, { status: 404 })
        }

        // Ver o comentário de autorização no GET da coleção: é por aqui que
        // entra o texto que o modelo lê como instrução e como fonte de verdade.
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const corpo = z
            .object({
                content: z
                    .string()
                    .max(doc.teto, `acima do teto de ${doc.teto.toLocaleString('pt-BR')} caracteres`),
            })
            .parse(await request.json())

        /**
         * **Salvar grava rascunho. Publicar é outro botão.**
         *
         * Até o passo 4 esta rota escrevia `content` e enfileirava a indexação:
         * salvar era publicar, e o agente respondia pelo texto novo na mensagem
         * seguinte. Isso tornava impossível o princípio 5 do estudo — nenhuma
         * mudança de treinamento publica sem número —, porque nunca havia dois
         * estados para comparar.
         *
         * Nada de indexação aqui, por consequência: vetorizar o rascunho
         * misturaria no acervo o texto que ainda não foi aprovado, e o agente
         * passaria a responder por ele. O embedding é pago uma vez, ao publicar.
         *
         * **Rascunho idêntico ao publicado é apagado**, não gravado. A tela
         * salva os sete juntos, e sem isto desfazer uma edição à mão deixaria
         * para trás um rascunho que não propõe nada — e a tela diria "há
         * mudanças para publicar" mentindo.
         */
        const atual = await prisma.agentTrainingDoc.findUnique({
            where: { agentId_slug: { agentId, slug } },
            select: { content: true },
        })

        const igualAoPublicado = (atual?.content ?? '') === corpo.content

        const gravado = await prisma.agentTrainingDoc.upsert({
            where: { agentId_slug: { agentId, slug } },
            /**
             * No documento que ainda não existe, `content` nasce **vazio** e o
             * texto vai para o rascunho.
             *
             * É o que mantém a promessa: nada chega ao agente sem passar por
             * Publicar, nem no primeiro texto que a clínica escreve.
             */
            create: { agentId, slug, content: '', draftContent: corpo.content },
            update: { draftContent: igualAoPublicado ? null : corpo.content },
            select: { indexedAt: true, indexedChunks: true, updatedAt: true },
        })

        return NextResponse.json({
            salvo: true,
            rascunho: !igualAoPublicado || atual === null,
            indexedAt: gravado.indexedAt,
            indexedChunks: gravado.indexedChunks,
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message ?? 'inválido' }, { status: 400 })
        }
        console.error('[TRAINING_PUT]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
