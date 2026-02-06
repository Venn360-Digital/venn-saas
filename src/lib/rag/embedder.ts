import 'server-only'
import { OpenAIEmbeddings } from '@langchain/openai'
import { DocumentChunker } from './chunker'
import prisma from '@/lib/prisma'
// Note: We use raw SQL for pgvector insertion as Prisma support is still limited/evolving for the unsupported type in this specific version setup
// or we use the specific Prisma syntax if available.
// In the schema we defined `embedding Unsupported("vector(1536)")?`
// Inserting this usually requires $executeRaw or specific typed inputs.

export class DocumentEmbedder {
  private embedder: OpenAIEmbeddings
  private chunker: DocumentChunker

  constructor() {
    this.embedder = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: 'text-embedding-3-small', // Lower cost, high performance
    })
    this.chunker = new DocumentChunker()
  }

  async processDocument(
    agentId: string,
    title: string,
    content: string,
    type: 'faq' | 'doc' | 'website',
    url?: string
  ) {
    // 1. Chunk content
    const chunks = await this.chunker.split(content)

    console.log(`[RAG] Split '${title}' into ${chunks.length} chunks.`)

    // 2. Generate embeddings
    // We can embed all at once or in batches. OpenAI limits batch size.
    // LangChain handles batching automatically usually, but let's be safe.
    const embeddings = await this.embedder.embedDocuments(chunks)

    // 3. Store in DB
    // We should store each chunk as a separate KnowledgeDocument row? 
    // Or one document with many chunks?
    // RAG best practice: Store Chunks as retrievable units.

    // In our schema: 
    // model KnowledgeDocument { ... content String, embedding ... }
    // So yes, each chunk is a row. But we might want a parent "Source" in the future.
    // For MVP, each chunk is a formatted KnowledgeDocument.
    // Or better: The title is the same, content is the chunk.

    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i]
      const vector = embeddings[i] // Array<number>

      // Insert using Prisma with a typed sql template literal or raw unsafe for vector
      // Prisma 5 supports vector if we cast it.

      // Need to format vector as string for PostgreSQL vector input: "[0.1, 0.2, ...]"
      const vectorString = `[${vector.join(',')}]`

      await prisma.$executeRaw`
        INSERT INTO "knowledge_documents" (
          "id", "agentId", "title", "content", "type", "url", "embedding", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${agentId}, ${title}, ${chunkContent}, ${type}, ${url}, ${vectorString}::vector, NOW(), NOW()
        );
      `
    }

    console.log(`[RAG] Stored ${chunks.length} vectors for '${title}'`)
  }
}
