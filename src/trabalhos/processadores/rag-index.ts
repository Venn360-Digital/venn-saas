import prisma from '@/lib/prisma'
import { DocumentEmbedder } from '@/lib/rag/embedder'
import { semComentarios } from '@/lib/rag/secoes'
import { hashDoConteudo, TIPO_DE_TREINAMENTO, tituloDoAcervo } from '@/lib/treinamento/indexar'
import { createLogger } from '@/trabalhos/registro'
import type { RagIndexJob } from '@/lib/queue/definitions'

const log = createLogger('RAG_INDEX')

/**
 * Chunk and embed one knowledge document.
 *
 * Previously this ran inside the `/api/rag/index` request, one OpenAI embedding
 * round trip per chunk in a sequential loop — a long PDF would simply time out
 * halfway through, leaving a partially indexed document behind.
 *
 * **Dois caminhos.** O antigo traz o texto dentro do job; o de treinamento traz
 * só `trainingSlug`, e o conteúdo é lido de `agent_training_docs`. A diferença
 * não é estilo: o payload da fila tem teto de 128 KB e este campo aceita 200 mil
 * caracteres (ver `src/lib/queue/tamanho.ts`), então documento grande **não cabe
 * na mensagem**. Levar referência também é o que torna a reindexação possível —
 * a fonte fica guardada, e é o que `knowledge_documents` nunca teve.
 */
export async function processRagIndex(payload: RagIndexJob): Promise<void> {
    if (payload.trainingSlug) {
        await indexarDocumentoDeTreinamento(payload.agentId, payload.trainingSlug)
        return
    }

    const { agentId, documentTitle, content, type, url, replaceExisting } = payload

    if (!content.trim()) {
        log.warn(`document "${documentTitle}" has no content; nothing to index`)
        return
    }

    if (replaceExisting) {
        // Re-indexing must not leave the previous generation of chunks behind,
        // or the retriever would mix stale and fresh text for the same source.
        const removed = await prisma.knowledgeDocument.deleteMany({
            where: { agentId, title: documentTitle },
        })
        if (removed.count > 0) {
            log.info(`removed ${removed.count} stale chunk(s) for "${documentTitle}"`)
        }
    }

    const embedder = new DocumentEmbedder()
    const trechos = await embedder.processDocument(agentId, documentTitle, content, type, url)

    log.info(`indexed "${documentTitle}" for agent ${agentId} in ${trechos} chunk(s)`)
}

/**
 * Um documento de treinamento: lê a fonte, corta, vetoriza e carimba.
 *
 * **Confere o hash antes de gastar embedding.** A tela salva os sete documentos
 * juntos e a rota já pula o que não mudou — mas duas gravações seguidas
 * enfileiram dois jobs, e sem esta conferência o segundo pagaria o embedding de
 * novo para indexar exatamente o mesmo texto.
 *
 * O carimbo (`indexedHash`/`indexedAt`/`indexedChunks`) descreve **o que está no
 * acervo**, e é por isso que o hash é calculado aqui, do texto que foi de fato
 * indexado, em vez de vir pronto no job: entre enfileirar e processar, o
 * conteúdo pode ter mudado.
 */
async function indexarDocumentoDeTreinamento(agentId: string, slug: string): Promise<void> {
    const doc = await prisma.agentTrainingDoc.findUnique({
        where: { agentId_slug: { agentId, slug } },
        select: { content: true, indexedHash: true },
    })

    if (!doc) {
        // Apagado entre o enfileiramento e agora. Não é erro: é corrida normal,
        // e quem apagou já removeu os trechos.
        log.warn(`training doc "${slug}" of agent ${agentId} is gone; nothing to index`)
        return
    }

    // Comentário de HTML é nota de quem escreve. Sem tirá-lo, "confirmar preço
    // com a recepção" seria vetorizado e apresentado ao modelo como fonte de
    // verdade.
    const conteudo = semComentarios(doc.content).trim()

    if (!conteudo) {
        log.warn(`training doc "${slug}" of agent ${agentId} is empty; nothing to index`)
        return
    }

    const hash = await hashDoConteudo(conteudo)
    if (hash === doc.indexedHash) {
        log.info(`training doc "${slug}" of agent ${agentId} unchanged; skipping embedding`)
        return
    }

    const titulo = tituloDoAcervo(slug)

    const removidos = await prisma.knowledgeDocument.deleteMany({
        where: { agentId, title: titulo, type: TIPO_DE_TREINAMENTO },
    })
    if (removidos.count > 0) {
        log.info(`removed ${removidos.count} stale chunk(s) for training doc "${slug}"`)
    }

    const embedder = new DocumentEmbedder()
    const trechos = await embedder.processDocument(agentId, titulo, conteudo, TIPO_DE_TREINAMENTO)

    await prisma.agentTrainingDoc.update({
        where: { agentId_slug: { agentId, slug } },
        data: { indexedHash: hash, indexedAt: new Date(), indexedChunks: trechos },
    })

    log.info(`indexed training doc "${slug}" for agent ${agentId} in ${trechos} chunk(s)`)
}
