import 'server-only'
import { OpenAIEmbeddings } from '@langchain/openai'
import prisma from '@/lib/prisma'

/** Uma linha do resultado da busca por similaridade. */
export interface KnowledgeMatch {
    id: string
    title: string
    content: string
    url: string | null
    type: string
    /** 1 − distância de cosseno; quanto maior, mais próximo da consulta. */
    similarity: number
}

export class DocumentRetriever {
    private embedder: OpenAIEmbeddings

    constructor() {
        this.embedder = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: 'text-embedding-3-small',
        })
    }

    async search(agentId: string, query: string, limit = 5): Promise<KnowledgeMatch[]> {
        // 1. Embed the query
        const queryEmbedding = await this.embedder.embedQuery(query)
        const vectorString = `[${queryEmbedding.join(',')}]`

        // 2. Perform similarity search options using pgvector operator <-> (L2 distance) or <=> (Cosine distance)
        // Cosine distance is usually best for text embeddings. 
        // The operator <=> is cosine distance in pgvector < 0.5.0, but usually we verify. 
        // Actually: <-> is L2, <=> is Cosine Distance, <#> is Negative Inner Product.
        // We want Cosine Similarity, so we order by distance ASC.

        // Note: We select matching docs for the specific agent.

        // `$queryRaw<T>` é o ponto onde a forma da linha precisa ser declarada:
        // SQL cru não tem como ser inferido. O SELECT acima e KnowledgeMatch
        // precisam ser mudados juntos.
        const results = await prisma.$queryRaw<KnowledgeMatch[]>`
      SELECT id, title, content, url, type, 1 - (embedding <=> ${vectorString}::vector) as similarity
      FROM "knowledge_documents"
      WHERE "agentId" = ${agentId}
      ORDER BY embedding <=> ${vectorString}::vector
      LIMIT ${limit};
    `

        return results
    }
}
