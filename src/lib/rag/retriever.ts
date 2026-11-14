import 'server-only'
import type { OpenAIEmbeddings } from '@langchain/openai'
import prisma from '@venn/db/cliente'
import { criarEmbeddings } from './embeddings'
import { candidatosDaBusca, maxPorDocumento, pisoDeSimilaridade } from './parametros'
import {
    diversificarPorDocumento,
    fundirRRF,
    reservarVagaParaProcedimento,
    termosLexicais,
    type Candidato,
} from './fusao'
import { TIPO_DE_CENARIO } from '@/lib/treinamento/indexar'

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
 * O piso e o número de trechos **não moram aqui**: ver `./parametros.ts`.
 *
 * Eles governam a busca e eram declarados em três arquivos com valores
 * diferentes — mudar a variável de ambiente fazia o medidor e o console de
 * ensaio mentirem em silêncio. O `limit` continua chegando por parâmetro, porque
 * quem decide quantos trechos cabem numa resposta é o chamador.
 */

/** Uma linha crua das duas pernas, antes da fusão. */
interface LinhaCandidata {
    id: string
    title: string
    content: string
    url: string | null
    type: string
    similarity: number
    vec_rank: number | null
    lex_rank: number | null
}

/**
 * Lembrete de módulo: a coluna lexical existe? `null` é "ainda não perguntei".
 *
 * Fora da classe porque `DocumentRetriever` é instanciado a cada busca, e a
 * resposta é sobre o banco, não sobre a instância.
 */
let colunaLexical: boolean | null = null

export class DocumentRetriever {
    private embedder: OpenAIEmbeddings

    constructor() {
        // O mesmo cliente de quem indexa: ver `embeddings.ts` para o que
        // divergir aqui custava.
        this.embedder = criarEmbeddings()
    }

    /**
     * Busca híbrida: vetor e texto, fundidos por posição.
     *
     * ## O que `textoLexical` é, e por que é separado de `query`
     *
     * `query` é a consulta expandida de `montarConsulta` — a pergunta atual mais
     * até 400 caracteres do que a pessoa já disse. Isso **serve ao vetor** e
     * envenena o lexical: palavra de outro assunto entra como termo de busca com
     * o mesmo peso. Então a perna lexical recebe só a última fala, e quem a
     * passa é o chamador, que é quem sabe qual é.
     *
     * Sem `textoLexical`, ou sem termo aproveitável nele, **só a perna de vetor
     * roda** — e o resultado é o de antes desta mudança. É o caminho de volta se
     * algo der errado em produção: a perna lexical é aditiva.
     *
     * ## Uma ida ao banco, duas CTEs
     *
     * As duas buscas vão no mesmo plano e o Postgres as resolve em paralelo
     * quando pode. Duas consultas separadas custariam duas viagens — no caminho
     * mais quente do sistema, uma por mensagem recebida.
     *
     * O `SELECT` final junta tudo e **calcula a similaridade de cosseno para
     * todos os candidatos**, inclusive os que só a perna lexical achou: é o
     * número que a tela de ensaio e o medidor mostram, e sem ele um trecho
     * lexical apareceria sem nota.
     *
     * ## O piso vale só para o vetor, de propósito
     *
     * O piso existe porque a busca de vetor **sempre** devolve os N menos
     * distantes, mesmo quando nada fala do assunto. A busca lexical não tem esse
     * problema: ou o radical casa, ou a linha não entra. Aplicar o piso de
     * cosseno a um acerto lexical descartaria justamente o caso que a perna veio
     * resolver — "R$ 180" casa no texto e fica longe no vetor.
     */
    /** Só a perna de vetor — o comportamento anterior à busca híbrida. */
    private async somenteVetor(agentId: string, vectorString: string) {
        return prisma.$queryRaw<LinhaCandidata[]>`
      SELECT id, title, content, url, type,
             1 - (embedding <=> ${vectorString}::vector) AS similarity,
             ROW_NUMBER() OVER (ORDER BY embedding <=> ${vectorString}::vector) AS vec_rank,
             NULL::bigint AS lex_rank
      FROM "knowledge_documents"
      WHERE "agentId" = ${agentId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${vectorString}::vector) >= ${pisoDeSimilaridade()}
      ORDER BY embedding <=> ${vectorString}::vector
      LIMIT ${candidatosDaBusca()};
    `
    }

    /**
     * As duas pernas numa ida ao banco, cada uma com a própria posição.
     *
     * `$queryRaw<T>` é o ponto onde a forma da linha precisa ser declarada: SQL
     * cru não tem como ser inferido. O SELECT e `LinhaCandidata` mudam juntos.
     *
     * Duas cláusulas da perna de vetor que não podem sair:
     *
     *   - `embedding IS NOT NULL`. FAQ, site e vídeo eram gravados como linha
     *     crua, sem vetor. Comparar NULL dá NULL, e NULL ordena por último no
     *     Postgres — então esses trechos só apareciam enquanto o agente tivesse
     *     menos trechos vetorizados que o limite. Bastava subir um PDF para as
     *     FAQs da clínica ficarem invisíveis para sempre.
     *   - o piso, aplicado no banco para não trazer linha que vai ser descartada
     *     depois.
     *
     * O `SELECT` final **calcula a similaridade para todos os candidatos**,
     * inclusive os que só o lexical achou: é o número que a tela de ensaio e o
     * medidor mostram, e sem ele um acerto lexical apareceria sem nota.
     *
     * O desempate por `d.id` dentro do `ROW_NUMBER` da perna lexical existe
     * porque `ts_rank_cd` empata com frequência em trecho curto — e sem ele a
     * mesma pergunta mudaria de ordem entre execuções, tornando a medição
     * irreprodutível.
     */
    private async hibrida(agentId: string, vectorString: string, termos: string) {
        const candidatos = candidatosDaBusca()

        return prisma.$queryRaw<LinhaCandidata[]>`
      WITH vetor AS (
          SELECT id,
                 ROW_NUMBER() OVER (ORDER BY embedding <=> ${vectorString}::vector) AS rank
          FROM "knowledge_documents"
          WHERE "agentId" = ${agentId}
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> ${vectorString}::vector) >= ${pisoDeSimilaridade()}
          ORDER BY embedding <=> ${vectorString}::vector
          LIMIT ${candidatos}
      ),
      consulta AS (
          SELECT to_tsquery('portuguese', public.immutable_unaccent(${termos})) AS q
      ),
      lexical AS (
          SELECT d.id,
                 ROW_NUMBER() OVER (
                     ORDER BY ts_rank_cd(d."searchVector", consulta.q) DESC, d.id
                 ) AS rank
          FROM "knowledge_documents" d, consulta
          WHERE d."agentId" = ${agentId}
            AND d."searchVector" @@ consulta.q
          ORDER BY ts_rank_cd(d."searchVector", consulta.q) DESC, d.id
          LIMIT ${candidatos}
      )
      SELECT d.id, d.title, d.content, d.url, d.type,
             1 - (d.embedding <=> ${vectorString}::vector) AS similarity,
             vetor.rank AS vec_rank,
             lexical.rank AS lex_rank
      FROM "knowledge_documents" d
      LEFT JOIN vetor ON vetor.id = d.id
      LEFT JOIN lexical ON lexical.id = d.id
      WHERE vetor.id IS NOT NULL OR lexical.id IS NOT NULL;
    `
    }

    async search(
        agentId: string,
        query: string,
        limit = 5,
        textoLexical?: string
    ): Promise<KnowledgeMatch[]> {
        const queryEmbedding = await this.embedder.embedQuery(query)
        const vectorString = `[${queryEmbedding.join(',')}]`

        const termos = textoLexical ? termosLexicais(textoLexical) : null

        /**
         * A perna lexical cai para trás quando a coluna ainda não existe.
         *
         * **Isto não é zelo, é sequência de deploy.** `retrieveKnowledge` engole
         * erro de busca e devolve lista vazia — de propósito, porque responder sem
         * fato é chato e não responder é pior. Mas se o código subir antes da
         * migração, o `SELECT` cita `searchVector`, o Postgres recusa a consulta
         * inteira, e **todo atendimento passa a responder sem base de conhecimento
         * nenhuma, em silêncio**. É o pior desfecho possível: o agente continua
         * respondendo, só responde pior, e nada na tela diz por quê.
         *
         * Com a queda para trás, código novo sobre banco velho perde só a perna
         * nova e mantém a busca de vetor — o comportamento de antes.
         */
        if (termos !== null && !(await this.temColunaLexical())) {
            return this.montar(await this.somenteVetor(agentId, vectorString), limit)
        }

        /**
         * **Dois caminhos, e não uma consulta com a perna desligada.**
         *
         * A tentação era uma SQL só, com `WHERE <tem termo>` apagando a CTE
         * lexical. Não funciona: `to_tsquery('')` é **erro de sintaxe** no
         * Postgres, não lista vazia, e a função é avaliada mesmo quando o
         * `WHERE` é falso — o planejador não garante ordem de avaliação. A
         * consulta morreria exatamente nas perguntas sem termo aproveitável.
         *
         * Separar também deixa o caminho de volta explícito: sem termo, a busca
         * é a de antes desta mudança, vetor puro.
         */
        const linhas =
            termos === null
                ? await this.somenteVetor(agentId, vectorString)
                : await this.hibrida(agentId, vectorString, termos)

        return this.montar(linhas, limit)
    }

    /**
     * A coluna lexical existe neste banco?
     *
     * Memoizado no módulo: é uma pergunta sobre o schema, não sobre a linha, e
     * perguntá-la a cada mensagem recebida seria uma ida ao banco a mais no
     * caminho mais quente do sistema. O isolate do Worker vive minutos, então a
     * resposta se renova sozinha depois de um deploy.
     */
    private async temColunaLexical(): Promise<boolean> {
        if (colunaLexical !== null) return colunaLexical

        try {
            const r = await prisma.$queryRaw<{ existe: boolean }[]>`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'knowledge_documents' AND column_name = 'searchVector'
                ) AS existe`
            colunaLexical = r[0]?.existe === true
        } catch {
            colunaLexical = false
        }

        return colunaLexical
    }

    /** Funde, corta por documento e devolve no formato que o chamador espera. */
    private montar(linhas: LinhaCandidata[], limit: number): KnowledgeMatch[] {
        const porId = new Map(linhas.map((l) => [l.id, l]))

        const fundidos = fundirRRF(
            linhas.map<Candidato>((l) => ({
                id: l.id,
                titulo: l.title,
                // O tipo não entra na nota: ele serve só à vaga reservada abaixo.
                tipo: l.type,
                posicaoVetor: l.vec_rank === null ? undefined : Number(l.vec_rank),
                posicaoLexical: l.lex_rank === null ? undefined : Number(l.lex_rank),
            }))
        )

        /**
         * Diversidade primeiro, vaga do procedimento depois — e a ordem importa.
         *
         * A diversificação decide quem entra pelo mérito da fusão, com teto por
         * documento. A reserva age **sobre o resultado dela**: se nenhum
         * procedimento entrou e havia um recuperável, ele toma a vaga do último.
         *
         * Invertido, o procedimento entraria antes de o teto por documento ser
         * aplicado e poderia ser ele mesmo cortado pela diversificação em
         * seguida — a reserva não valeria nada.
         */
        const escolhidos = reservarVagaParaProcedimento(
            diversificarPorDocumento(fundidos, maxPorDocumento(), limit),
            fundidos,
            limit,
            TIPO_DE_CENARIO
        )

        return escolhidos.map((c) => {
            const l = porId.get(c.id)!
            return {
                id: l.id,
                title: l.title,
                content: l.content,
                url: l.url,
                type: l.type,
                /**
                 * Similaridade pode vir nula quando o trecho não tem vetor e só a
                 * perna lexical o achou — hoje não acontece, porque todo trecho é
                 * indexado com vetor, mas linha legado existe.
                 */
                similarity: typeof l.similarity === 'number' ? l.similarity : 0,
            }
        })
    }
}
