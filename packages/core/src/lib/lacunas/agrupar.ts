/**
 * Agrupar as perguntas que o agente não soube responder.
 *
 * Parte pura. Quem busca as lacunas e paga os embeddings é o job semanal; aqui
 * mora a decisão de **o que é a mesma pergunta**.
 *
 * ## Por que agrupar, e não listar
 *
 * Uma lista crua de lacunas é inútil depois da primeira semana: "quanto custa
 * clareamento", "qual o valor do clareamento" e "clareamento é caro?" são três
 * linhas e **um** documento faltando. Sem agrupar, quem aprova lê trinta linhas
 * para descobrir que há quatro assuntos — e a contagem de demanda, que é o que
 * ordena a fila, fica errada por desenho.
 *
 * ## Por que vetor e não palavra
 *
 * As três frases acima quase não compartilham palavras com a quarta forma de
 * perguntar a mesma coisa ("tem promoção pra deixar o dente branco?"). O
 * agrupamento lexical juntaria as três e perderia a quarta, que é justamente a
 * que a clínica não previu. O embedding já é pago uma vez por lacuna, em lote.
 */

/** O que o agrupamento precisa saber de cada lacuna. */
export interface LacunaParaAgrupar {
    id: string
    pergunta: string
    /** O embedding da pergunta. Normalizado ou não — o cosseno cuida disso. */
    vetor: number[]
}

export interface Grupo {
    /** A lacuna que representa o grupo na fila de aprovação. */
    representante: LacunaParaAgrupar
    /** Os ids de todas as lacunas do grupo, incluindo o representante. */
    ids: string[]
    /** Quantas vezes esta pergunta apareceu. É o que ordena a fila. */
    demanda: number
}

/**
 * O limiar de "é a mesma pergunta".
 *
 * **0,82 é um palpite calibrado para baixo, e está declarado como tal.** Com
 * `text-embedding-3-small`, paráfrases de uma mesma pergunta ficam tipicamente
 * acima de 0,85 e perguntas de assuntos vizinhos ("quanto custa clareamento" ×
 * "quanto custa limpeza") ficam na faixa de 0,75-0,85 — ou seja, a fronteira
 * passa dentro da zona cinzenta, e nenhum número acerta sempre.
 *
 * Errar para **menos** agrupamento é o erro certo: dois grupos para o mesmo
 * assunto custam ao instrutor aprovar duas entradas parecidas, e ele vê que são
 * parecidas. Um grupo que juntou dois assuntos produz **um rascunho que mistura
 * os dois**, e aí o erro entra no acervo.
 *
 * Tem de ser recalibrado com lacunas reais — hoje a tabela está vazia, porque o
 * passo 3 acabou de subir.
 */
export const LIMIAR_DE_GRUPO = 0.82

/**
 * A forma canônica de uma pergunta, para descartar repetição literal **antes**
 * de pagar embedding.
 *
 * Minúsculas, sem acento, sem pontuação, espaços colapsados. Duas pessoas
 * escrevendo "Quanto custa?" e "quanto custa" são uma pergunta e um embedding,
 * não dois.
 */
export function normalizarPergunta(pergunta: string): string {
    return pergunta
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Similaridade de cosseno entre dois vetores.
 *
 * Devolve 0 quando os tamanhos não batem ou quando um deles é nulo: é o valor
 * que faz o par **não** ser agrupado, que é o desfecho seguro. Lançar aqui
 * derrubaria a mineração semanal inteira por causa de uma linha com vetor
 * corrompido.
 */
export function cosseno(a: number[], b: number[]): number {
    if (a.length === 0 || a.length !== b.length) return 0

    let produto = 0
    let normaA = 0
    let normaB = 0
    for (let i = 0; i < a.length; i++) {
        produto += a[i] * b[i]
        normaA += a[i] * a[i]
        normaB += b[i] * b[i]
    }

    if (normaA === 0 || normaB === 0) return 0
    return produto / (Math.sqrt(normaA) * Math.sqrt(normaB))
}

/**
 * Escolhe quem representa o grupo: **o mais central**.
 *
 * Não o primeiro (seria o mais antigo, por acidente de ordem) nem o mais curto
 * (seria "quanto?"). O mais central é a formulação que mais se parece com as
 * outras, que é o que o instrutor quer ler na fila.
 *
 * Desempate pelo mais curto, e depois pelo id — porque o resultado tem de ser o
 * mesmo em duas execuções sobre os mesmos dados, senão a fila de aprovação
 * reordena sozinha entre uma semana e outra.
 */
export function maisCentral(itens: LacunaParaAgrupar[]): LacunaParaAgrupar {
    if (itens.length === 1) return itens[0]

    let melhor = itens[0]
    let melhorMedia = -Infinity

    for (const item of itens) {
        const soma = itens.reduce((s, outro) => (outro === item ? s : s + cosseno(item.vetor, outro.vetor)), 0)
        const media = soma / (itens.length - 1)

        const empatou = Math.abs(media - melhorMedia) < 1e-9
        const ganha = media > melhorMedia
        const ganhaNoDesempate =
            empatou &&
            (item.pergunta.length < melhor.pergunta.length ||
                (item.pergunta.length === melhor.pergunta.length && item.id < melhor.id))

        if (ganha || ganhaNoDesempate) {
            melhor = item
            melhorMedia = media
        }
    }

    return melhor
}

/**
 * Agrupa por similaridade, num passe só.
 *
 * **Agrupamento por líder, e não k-médias ou hierárquico**, por três razões:
 * não exige saber quantos grupos existem (ninguém sabe), roda em uma passada
 * sobre dezenas ou centenas de lacunas, e é **determinístico** — que é a
 * propriedade que a fila de aprovação precisa para não reordenar sozinha.
 *
 * A entrada é ordenada por id antes de começar, de propósito: agrupamento por
 * líder depende da ordem, e depender da ordem em que o banco devolveu as linhas
 * faria o mesmo conjunto produzir grupos diferentes entre execuções.
 *
 * Compara contra o **representante** de cada grupo, não contra todos os membros.
 * Comparar com todos permitiria uma cadeia — A parecido com B, B com C, A nada
 * a ver com C — que é como dois assuntos acabam no mesmo grupo.
 */
export function agrupar(itens: LacunaParaAgrupar[], limiar = LIMIAR_DE_GRUPO): Grupo[] {
    const ordenados = [...itens].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const grupos: { lider: LacunaParaAgrupar; membros: LacunaParaAgrupar[] }[] = []

    for (const item of ordenados) {
        let destino: (typeof grupos)[number] | undefined
        let melhor = limiar

        for (const g of grupos) {
            const s = cosseno(item.vetor, g.lider.vetor)
            // `>=` e não `>`: o primeiro grupo que alcança o limiar exato leva, e
            // o laço segue procurando um melhor. Sem o empate explícito, um item
            // exatamente no limiar ficaria sozinho.
            if (s >= melhor) {
                melhor = s
                destino = g
            }
        }

        if (destino) destino.membros.push(item)
        else grupos.push({ lider: item, membros: [item] })
    }

    return grupos.map((g) => {
        const representante = maisCentral(g.membros)
        return {
            representante,
            ids: g.membros.map((m) => m.id).sort(),
            demanda: g.membros.length,
        }
    })
}

/**
 * Ordena a fila: mais demanda primeiro.
 *
 * É a ordem que o estudo pede ("lista agrupada por demanda") e é a ordem certa
 * de trabalho: a pergunta que vinte pessoas fizeram vale mais do que a que uma
 * fez. Desempate pelo id do representante, para a ordem ser reprodutível.
 */
export function ordenarPorDemanda(grupos: Grupo[]): Grupo[] {
    return [...grupos].sort((a, b) => {
        if (b.demanda !== a.demanda) return b.demanda - a.demanda
        return a.representante.id < b.representante.id ? -1 : 1
    })
}
