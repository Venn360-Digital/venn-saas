import prisma from '@/lib/prisma'
import { DocumentEmbedder } from '@/lib/rag/embedder'
import { createLogger } from '@/trabalhos/registro'
import type { RagIndexJob } from '@/lib/queue/definitions'

const log = createLogger('RAG_INDEX')

/**
 * Chunk and embed one knowledge document.
 *
 * Previously this ran inside the `/api/rag/index` request, one OpenAI embedding
 * round trip per chunk in a sequential loop — a long PDF would simply time out
 * halfway through, leaving a partially indexed document behind.
 */
export async function processRagIndex(payload: RagIndexJob): Promise<void> {
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
