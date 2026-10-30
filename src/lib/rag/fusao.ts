/**
 * A fusão das duas buscas, e o corte por documento — parte pura.
 *
 * ## Por que duas buscas
 *
 * A busca por vetor acha o que **fala do mesmo assunto** e erra no termo exato.
 * Medido na própria medição de recuperação, em 2026-10-29:
 *
 *   - **`faq` dominava**: 36 recuperações contra 18 de `servicos`, e primeira
 *     colocada em 13 contra 1. O documento de FAQ é escrito **em forma de
 *     pergunta**, o que o aproxima vetorialmente de qualquer pergunta — vantagem
 *     estrutural, não de qualidade.
 *   - **`servicos` perdia as perguntas de preço**, porque "R$ 180" não tem
 *     vizinho vetorial útil: o número não carrega sentido, carrega identidade.
 *
 * Os dois são o mesmo defeito visto de dois lados: o vetor não sabe casar
 * símbolo. Quem sabe é a busca lexical do Postgres — `tsvector` com a
 * configuração `portuguese`, que faz radical e descarta palavra vazia.
 *
 * ## Por que RRF, e não somar notas
 *
 * As duas buscas devolvem notas **em escalas diferentes**: cosseno vive entre 0
 * e 1, `ts_rank_cd` não tem teto e depende do tamanho do texto. Somar ou fazer
 * média exige normalizar, e normalizar exige conhecer a distribuição — que muda
 * a cada acervo e a cada pergunta.
 *
 * *Reciprocal Rank Fusion* ignora a nota e usa só a **posição**: cada busca
 * contribui `1/(k + posição)`. Não precisa de calibração, é estável quando uma
 * das buscas devolve pouco, e é o que a literatura de 2026 trata como padrão de
 * produção. O `k` amortece a diferença entre as primeiras posições — com
 * `k = 60`, primeiro e segundo lugar diferem 2%, não 50%.
 *
 * ## O corte por documento é tão importante quanto a fusão
 *
 * Sem ele, um documento bem escrito ocupa as cinco vagas e o agente responde
 * sem ver o resto do acervo — que é exatamente o que a FAQ fazia. Com teto por
 * documento, a resposta passa a ter **fontes diferentes**, que é o que uma
 * pergunta de preço precisa: o serviço e a condição de pagamento moram em
 * documentos distintos.
 */

/** Uma linha candidata, como as duas buscas a devolvem. */
export interface Candidato {
    id: string
    /** O documento de origem. Nos de treinamento é o slug. */
    titulo: string
    /** Posição na busca por vetor, 1 em diante. Ausente quando só o lexical achou. */
    posicaoVetor?: number
    /** Posição na busca lexical, 1 em diante. Ausente quando só o vetor achou. */
    posicaoLexical?: number
}

/**
 * O amortecedor do RRF.
 *
 * Sessenta é o valor do artigo original e o que as implementações usam. Baixá-lo
 * faz a primeira posição valer desproporcionalmente — com `k = 1`, o primeiro
 * lugar vale o dobro do segundo, e aí a fusão vira "quem ganhou a primeira
 * busca", que é o que ela existe para não ser.
 */
export const K_RRF = 60

/** O candidato com a nota da fusão, para quem quiser inspecionar. */
export interface Fundido extends Candidato {
    nota: number
}

/**
 * Funde as duas listas pela posição, e devolve ordenado da melhor para a pior.
 *
 * Candidato achado pelas **duas** buscas soma as duas contribuições, e é assim
 * que a concordância entre elas vira vantagem sem precisar de regra extra.
 *
 * O desempate é pelo `id`, e não é capricho: sem ele, dois candidatos de nota
 * idêntica saem na ordem que o banco devolveu, e a mesma pergunta passa a
 * recuperar coisas diferentes entre execuções — o que torna a medição
 * irreprodutível.
 */
export function fundirRRF(candidatos: Candidato[], k = K_RRF): Fundido[] {
    const nota = (c: Candidato) =>
        (c.posicaoVetor ? 1 / (k + c.posicaoVetor) : 0) +
        (c.posicaoLexical ? 1 / (k + c.posicaoLexical) : 0)

    return candidatos
        .map((c) => ({ ...c, nota: nota(c) }))
        .filter((c) => c.nota > 0)
        .sort((a, b) => b.nota - a.nota || a.id.localeCompare(b.id))
}

/**
 * Corta a lista com teto por documento, preservando a ordem recebida.
 *
 * Varre uma vez e descarta o que excede o teto do documento — então o 4º trecho
 * do mesmo documento cede a vaga ao 1º de outro, **sem** reordenar nada. Não é
 * MMR nem nada que meça diversidade de conteúdo: é o teto que impede um
 * documento de ocupar a resposta inteira, e é o que a medição pedia.
 */
export function diversificarPorDocumento<T extends { titulo: string }>(
    ordenados: T[],
    maxPorDocumento: number,
    limite: number
): T[] {
    if (limite <= 0) return []

    const porDocumento = new Map<string, number>()
    const saida: T[] = []

    for (const item of ordenados) {
        if (saida.length >= limite) break

        const usados = porDocumento.get(item.titulo) ?? 0
        if (maxPorDocumento > 0 && usados >= maxPorDocumento) continue

        porDocumento.set(item.titulo, usados + 1)
        saida.push(item)
    }

    /**
     * Segunda passada, só se sobrou vaga.
     *
     * O teto é para **espalhar**, não para entregar menos: num acervo de um
     * documento só — o começo de toda clínica — a primeira passada devolveria
     * três trechos e deixaria duas vagas vazias. Aqui as vagas que ninguém
     * disputou voltam para quem foi cortado, na ordem da fusão.
     */
    if (saida.length < limite) {
        const dentro = new Set(saida)
        for (const item of ordenados) {
            if (saida.length >= limite) break
            if (!dentro.has(item)) saida.push(item)
        }
    }

    return saida
}

/**
 * Os termos que vão para a busca lexical, em OU — e o porquê de ser em OU.
 *
 * `plainto_tsquery` e `websearch_to_tsquery` juntam os termos com **E**. Numa
 * pergunta de paciente isso devolve zero quase sempre: "quanto custa o aparelho
 * transparente" exigiria os quatro radicais no mesmo trecho. Com OU, cada termo
 * é uma chance de casar, e quem decide a relevância é o `ts_rank_cd` — que já
 * premia o trecho que casa mais termos.
 *
 * **Recebe só a última fala da pessoa**, e não a consulta expandida. A expansão
 * de `montarConsulta` acrescenta até 400 caracteres de mensagens anteriores, o
 * que serve ao vetor e envenena o lexical: palavra de outro assunto vira termo
 * de busca com o mesmo peso.
 *
 * Devolve `null` quando não sobra termo nenhum — e aí a perna lexical **não
 * roda**. `to_tsquery('')` é erro de sintaxe no Postgres, não lista vazia.
 */
export function termosLexicais(texto: string, maxTermos = 10): string | null {
    const termos = texto
        .toLowerCase()
        // Só letra, dígito e espaço. Pontuação e símbolo (`R$`, `?`, `!`) são
        // operadores dentro de `to_tsquery` e derrubariam a consulta.
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3)

    const unicos = [...new Set(termos)].slice(0, maxTermos)
    return unicos.length > 0 ? unicos.join(' | ') : null
}
