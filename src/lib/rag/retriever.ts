import 'server-only'
import type { OpenAIEmbeddings } from '@langchain/openai'
import prisma from '@/lib/prisma'
import { criarEmbeddings } from './embeddings'

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

/**
 * Piso de similaridade para um trecho entrar na resposta.
 *
 * Sem piso, a busca devolvia sempre os N trechos mais próximos — e o prompt os
 * apresenta ao modelo como "fonte de verdade". Numa clínica cujo cérebro fala de
 * ortodontia, "vocês fazem exame de vista?" trazia os quatro trechos menos
 * distantes do acervo e pedia ao modelo que respondesse com base neles.
 *
 * 0,35 com o modelo de `EMBEDDING_MODEL` separa "fala do mesmo assunto" de "é o
 * texto menos distante que eu tinha". Ajustável por ambiente porque o valor
 * depende do tamanho e da variedade do acervo de cada clínica — e **precisa ser
 * reavaliado se o modelo de embedding mudar**, porque a escala de similaridade
 * é propriedade do modelo, não do acervo.
 */
const DEFAULT_MIN_SIMILARITY = 0.35

function minSimilarity(): number {
    const raw = Number(process.env.AI_RAG_MIN_SIMILARITY)
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_MIN_SIMILARITY
}

export class DocumentRetriever {
    private embedder: OpenAIEmbeddings

    constructor() {
        // O mesmo cliente de quem indexa: ver `embeddings.ts` para o que
        // divergir aqui custava.
        this.embedder = criarEmbeddings()
    }

    async search(agentId: string, query: string, limit = 5): Promise<KnowledgeMatch[]> {
        const queryEmbedding = await this.embedder.embedQuery(query)
        const vectorString = `[${queryEmbedding.join(',')}]`

        /**
         * `<=>` é distância de cosseno no pgvector, então a ordenação é
         * crescente e a similaridade é `1 - distância`.
         *
         * Duas cláusulas que faltavam, e que juntas explicavam o comportamento
         * mais estranho do Cérebro:
         *
         *   - `embedding IS NOT NULL`. FAQ, site e vídeo eram gravados como linha
         *     crua, sem vetor. Comparar NULL dá NULL, e NULL ordena por último
         *     no Postgres — então esses trechos só apareciam enquanto o agente
         *     tivesse menos trechos vetorizados que o limite. Bastava subir um
         *     PDF para as FAQs da clínica ficarem invisíveis para sempre, sem
         *     nenhum aviso. Agora todas as fontes são indexadas com vetor, e
         *     este filtro garante que uma linha sem vetor — legado ou meio
         *     indexada — não entre no lugar de um trecho de verdade.
         *   - o piso de similaridade, aplicado no banco para não trazer linha
         *     que vai ser descartada aqui.
         *
         * `$queryRaw<T>` é o ponto onde a forma da linha precisa ser declarada:
         * SQL cru não tem como ser inferido. O SELECT e KnowledgeMatch precisam
         * ser mudados juntos.
         */
        const results = await prisma.$queryRaw<KnowledgeMatch[]>`
      SELECT id, title, content, url, type, 1 - (embedding <=> ${vectorString}::vector) AS similarity
      FROM "knowledge_documents"
      WHERE "agentId" = ${agentId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${vectorString}::vector) >= ${minSimilarity()}
      ORDER BY embedding <=> ${vectorString}::vector
      LIMIT ${limit};
    `

        return results
    }
}
