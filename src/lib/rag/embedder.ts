import 'server-only'
import type { OpenAIEmbeddings } from '@langchain/openai'
import { DocumentChunker } from './chunker'
import { criarEmbeddings } from './embeddings'
import type { RagDocType } from '@/lib/queue/definitions'
import prisma from '@/lib/prisma'

/**
 * Corta uma fonte em trechos, vetoriza cada um e grava.
 *
 * **Um trecho é uma linha de `knowledge_documents`**, não um documento com
 * trechos dentro: a unidade recuperável é o trecho, então é ele que carrega o
 * vetor. Todos os trechos de uma fonte dividem o mesmo `title`, e é por ele que
 * a reindexação apaga a geração anterior (ver `processRagIndex`).
 *
 * A inserção é por SQL cru porque `embedding` é `Unsupported("vector(1536)")` no
 * schema — o Prisma não gera escrita para o tipo do pgvector, e o valor precisa
 * chegar como `'[0.1,0.2,…]'::vector`.
 */
export class DocumentEmbedder {
    private embedder: OpenAIEmbeddings
    private chunker: DocumentChunker

    constructor() {
        // O mesmo cliente de quem busca: ver `embeddings.ts`.
        this.embedder = criarEmbeddings()
        this.chunker = new DocumentChunker()
    }

    /** Devolve quantos trechos foram gravados — é o que o registro relata. */
    async processDocument(
        agentId: string,
        title: string,
        content: string,
        type: RagDocType,
        url?: string
    ): Promise<number> {
        const chunks = await this.chunker.split(content)

        // O LangChain já agrupa a chamada em lotes do tamanho que o provedor
        // aceita; pedir um por um multiplicaria as idas sem ganho nenhum.
        const embeddings = await this.embedder.embedDocuments(chunks)

        for (let i = 0; i < chunks.length; i++) {
            const vectorString = `[${embeddings[i].join(',')}]`

            await prisma.$executeRaw`
                INSERT INTO "knowledge_documents" (
                    "id", "agentId", "title", "content", "type", "url", "embedding", "createdAt", "updatedAt"
                ) VALUES (
                    gen_random_uuid(), ${agentId}, ${title}, ${chunks[i]}, ${type}, ${url}, ${vectorString}::vector, NOW(), NOW()
                );
            `
        }

        return chunks.length
    }
}
