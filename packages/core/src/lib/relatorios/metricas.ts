/**
 * As contas dos relatórios — puras, sem Prisma, sem fuso, sem sessão.
 *
 * ## Por que separado das consultas
 *
 * O mesmo motivo de `lib/propostas/calculo.ts`: é o único jeito de exercitar
 * sem Postgres, e é aqui que mora o tipo de erro que não quebra nada. Uma
 * média calculada sobre o denominador errado não falha — ela dá um número
 * plausível, a clínica decide com ele, e ninguém descobre.
 *
 * ## Três decisões que este arquivo carrega
 *
 * **1. Denominador vazio devolve `null`, não zero.** "Não há taxa de aceite" é
 * diferente de "a taxa de aceite é 0%": o primeiro é uma clínica que ainda não
 * mandou proposta, o segundo é uma que mandou e nenhuma foi aceita. Zerar os
 * dois juntos é o defeito que o próprio estudo do Ploomes avisa — *"dashboard
 * construído antes de o histórico acumular mostra zeros"* —, e ele faz o
 * gestor concluir que o funil parou quando ele nem começou.
 *
 * **2. A taxa de aceite exclui o que ainda está em jogo.** O denominador é
 * `aceitas + recusadas + expiradas`, não o total de enviadas. Proposta enviada
 * ontem, dentro do prazo, não é uma derrota ainda — contá-la como tal faria a
 * taxa cair sempre que o vendedor trabalhasse mais.
 *
 * **3. Tempo até o aceite se lê pela MEDIANA.** Uma proposta aceita em 90 dias
 * — porque o cliente sumiu e voltou — arrasta a média para longe de toda
 * experiência real. A média vai junto, para quem quiser, mas o número que a
 * tela destaca é a mediana.
 */

/** Uma quantia, sempre acompanhada da moeda. Ver `somarPorMoeda`. */
export interface QuantiaPorMoeda {
    moeda: string
    total: number
    /** Quantos registros compõem esta quantia. */
    quantos: number
}

/**
 * Soma por moeda, **nunca entre moedas**.
 *
 * Um negócio em dólar e outro em real não somam num total único: o resultado
 * não é dinheiro nenhum. O estudo do Ploomes registra que o alvo também não
 * converte, e converter exigiria taxa de câmbio datada — que este produto não
 * tem e não deveria inventar.
 *
 * Então todo total agregado deste módulo é uma LISTA, e a tela mostra uma linha
 * por moeda. Com uma moeda só — o caso de praticamente toda unidade — a lista
 * tem um item e se lê como um número.
 */
export function somarPorMoeda(
    linhas: readonly { moeda: string; valor: number }[]
): QuantiaPorMoeda[] {
    const por = new Map<string, { total: number; quantos: number }>()
    for (const linha of linhas) {
        const atual = por.get(linha.moeda) ?? { total: 0, quantos: 0 }
        atual.total += linha.valor
        atual.quantos += 1
        por.set(linha.moeda, atual)
    }
    return [...por.entries()]
        .map(([moeda, v]) => ({ moeda, total: arredondar(v.total), quantos: v.quantos }))
        // Maior primeiro: a moeda principal da unidade encabeça a lista sem
        // precisar de uma configuração que diga qual é.
        .sort((a, b) => b.total - a.total)
}

/** Duas casas, meio para cima. O mesmo critério de `lib/propostas/calculo.ts`. */
function arredondar(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * A mediana de uma lista. `null` quando não há nada de que tirá-la.
 *
 * Com número par de elementos, a média dos dois centrais — é a definição, e
 * pegar só o de baixo enviesaria para baixo em toda amostra par.
 */
export function mediana(valores: readonly number[]): number | null {
    if (valores.length === 0) return null
    const ordenado = [...valores].sort((a, b) => a - b)
    const meio = Math.floor(ordenado.length / 2)
    if (ordenado.length % 2 === 1) return ordenado[meio]
    return (ordenado[meio - 1] + ordenado[meio]) / 2
}

/** A média. `null` quando a lista é vazia — ver a decisão 1 no cabeçalho. */
export function media(valores: readonly number[]): number | null {
    if (valores.length === 0) return null
    return arredondar(valores.reduce((s, v) => s + v, 0) / valores.length)
}

/**
 * Uma proporção, em por cento. `null` quando o denominador é zero.
 *
 * É a função que impede o relatório de afirmar 0% para quem não tem histórico.
 */
export function proporcao(parte: number, total: number): number | null {
    if (total <= 0) return null
    return arredondar((parte / total) * 100)
}

// ──────────────────────────── propostas ────────────────────────────

/** Uma proposta, como o relatório a enxerga. Só o que entra em alguma conta. */
export interface PropostaParaMetrica {
    moeda: string
    /** O total da revisão vigente. */
    valor: number
    /** O estado da revisão vigente. */
    estado: string
    /** Versões que a proposta teve até agora. */
    versoes: number
    /** Quando o link foi compartilhado pela primeira vez. */
    enviadaEm: Date | null
    /** Quando o cliente aceitou, se aceitou. */
    aceitaEm: Date | null
    /** Quantas vezes o cliente abriu o link, somando todos os links. */
    aberturas: number
}

export interface MetricasDePropostas {
    /** Quantas propostas o período produziu. */
    quantas: number
    /** Quantas chegaram a ser enviadas ao cliente. */
    enviadas: number
    aceitas: number
    recusadas: number
    expiradas: number
    /** Enviadas que ainda estão em jogo: nem aceitas, nem recusadas, nem expiradas. */
    emAberto: number
    /**
     * Taxa de aceite sobre o que já se **decidiu**. `null` sem nada decidido.
     * Ver a decisão 2 no cabeçalho.
     */
    taxaDeAceite: number | null
    /** Dias até o aceite: a mediana é o número que se lê. */
    diasAteAceiteMediana: number | null
    diasAteAceiteMedia: number | null
    /** Versões até o aceite — quanto se renegocia antes de fechar. */
    versoesAteAceiteMedia: number | null
    /**
     * **Enviadas que o cliente nunca abriu.** O dado que nenhum CRM comum tem,
     * porque quem manda PDF anexo não sabe se foi lido.
     */
    nuncaAbertas: number
    taxaDeNuncaAbertas: number | null
    aberturasPorPropostaMedia: number | null
    /** Valor aceito, uma linha por moeda. Nunca somado entre moedas. */
    valorAceito: QuantiaPorMoeda[]
    /** Valor que ainda está em jogo. */
    valorEmAberto: QuantiaPorMoeda[]
}

const DIA_EM_MS = 86_400_000

export function metricasDePropostas(
    propostas: readonly PropostaParaMetrica[]
): MetricasDePropostas {
    const aceitas = propostas.filter((p) => p.estado === 'aceita')
    const recusadas = propostas.filter((p) => p.estado === 'recusada')
    const expiradas = propostas.filter((p) => p.estado === 'expirada')
    /**
     * "Enviada" aqui é **ter sido compartilhada**, não estar no estado
     * `enviada`: uma proposta aceita já saiu daquele estado e obviamente foi
     * enviada. Usar o estado como filtro faria a conta esquecer justamente as
     * que deram certo.
     */
    const enviadas = propostas.filter((p) => p.enviadaEm !== null)
    const emAberto = enviadas.filter(
        (p) => p.estado !== 'aceita' && p.estado !== 'recusada' && p.estado !== 'expirada'
    )

    const decididas = aceitas.length + recusadas.length + expiradas.length

    const diasAteAceite = aceitas
        .filter((p) => p.enviadaEm && p.aceitaEm)
        .map((p) => (p.aceitaEm!.getTime() - p.enviadaEm!.getTime()) / DIA_EM_MS)
        // Negativo não existe, mas relógio e migração de dado produzem
        // surpresa; descartar é melhor que mostrar "-3 dias".
        .filter((d) => d >= 0)

    const nuncaAbertas = enviadas.filter((p) => p.aberturas === 0)

    return {
        quantas: propostas.length,
        enviadas: enviadas.length,
        aceitas: aceitas.length,
        recusadas: recusadas.length,
        expiradas: expiradas.length,
        emAberto: emAberto.length,
        taxaDeAceite: proporcao(aceitas.length, decididas),
        diasAteAceiteMediana: arredondarOuNulo(mediana(diasAteAceite), 1),
        diasAteAceiteMedia: arredondarOuNulo(media(diasAteAceite), 1),
        versoesAteAceiteMedia: media(aceitas.map((p) => p.versoes)),
        nuncaAbertas: nuncaAbertas.length,
        taxaDeNuncaAbertas: proporcao(nuncaAbertas.length, enviadas.length),
        aberturasPorPropostaMedia: media(enviadas.map((p) => p.aberturas)),
        valorAceito: somarPorMoeda(aceitas.map((p) => ({ moeda: p.moeda, valor: p.valor }))),
        valorEmAberto: somarPorMoeda(emAberto.map((p) => ({ moeda: p.moeda, valor: p.valor }))),
    }
}

function arredondarOuNulo(n: number | null, casas: number): number | null {
    if (n === null) return null
    const f = 10 ** casas
    return Math.round(n * f) / f
}

// ──────────────────────────── produtos ────────────────────────────

/** Uma linha de item de proposta, para o relatório de produto. */
export interface ItemParaMetrica {
    /** O item do catálogo. Nulo em linha escrita à mão. */
    productServiceId: string | null
    /** A descrição CONGELADA na revisão — é o que o cliente leu. */
    descricao: string
    quantidade: number
    /** O total da linha, já com desconto. */
    total: number
    moeda: string
    /** O estado da revisão a que o item pertence. */
    estadoDaRevisao: string
}

export interface LinhaDeProduto {
    productServiceId: string | null
    descricao: string
    /** Em quantas propostas este item apareceu. */
    propostas: number
    quantidade: number
    /** Receita só do que foi ACEITO. Ver a nota em `metricasDeProdutos`. */
    receita: QuantiaPorMoeda[]
    /** Quantas vezes apareceu em proposta aceita. */
    aceitas: number
    /** Converte: aceitas sobre as decididas em que apareceu. */
    taxaDeAceite: number | null
}

/**
 * O que vende — **o primeiro relatório por produto que o produto pode ter**.
 *
 * Era impossível até 21/11/2026, e não por falta de tela: `Deal` não tem itens.
 * O valor do negócio era um campo livre digitado, então não havia como saber o
 * que, dentro dele, foi vendido. `ProposalItem.productServiceId` é o que mudou.
 *
 * **A receita conta só o aceito.** Somar proposta em aberto daria uma receita
 * que não entrou — e, pior, uma que cresce quando o vendedor manda mais
 * propostas, independentemente de fechar. O que está em jogo tem coluna
 * própria no relatório de propostas.
 *
 * Linha escrita à mão (sem `productServiceId`) é agrupada pela **descrição**:
 * ela não é do catálogo, mas "Deslocamento" cobrado quarenta vezes é informação
 * — provavelmente a de que ele deveria estar no catálogo.
 */
export function metricasDeProdutos(itens: readonly ItemParaMetrica[]): LinhaDeProduto[] {
    const por = new Map<
        string,
        {
            productServiceId: string | null
            descricao: string
            propostas: number
            quantidade: number
            aceitas: number
            decididas: number
            receita: { moeda: string; valor: number }[]
        }
    >()

    for (const item of itens) {
        // A chave é o id quando há; a descrição quando não. Agrupar tudo que não
        // é do catálogo sob uma linha "outros" esconderia exatamente o que vale
        // ver: o item que falta cadastrar.
        const chave = item.productServiceId ?? `texto:${item.descricao.trim().toLowerCase()}`
        const atual =
            por.get(chave) ??
            {
                productServiceId: item.productServiceId,
                descricao: item.descricao,
                propostas: 0,
                quantidade: 0,
                aceitas: 0,
                decididas: 0,
                receita: [],
            }

        atual.propostas += 1
        atual.quantidade += item.quantidade

        const aceita = item.estadoDaRevisao === 'aceita'
        const decidida =
            aceita || item.estadoDaRevisao === 'recusada' || item.estadoDaRevisao === 'expirada'
        if (aceita) {
            atual.aceitas += 1
            atual.receita.push({ moeda: item.moeda, valor: item.total })
        }
        if (decidida) atual.decididas += 1

        por.set(chave, atual)
    }

    return [...por.values()]
        .map((v) => ({
            productServiceId: v.productServiceId,
            descricao: v.descricao,
            propostas: v.propostas,
            quantidade: arredondar(v.quantidade),
            receita: somarPorMoeda(v.receita),
            aceitas: v.aceitas,
            taxaDeAceite: proporcao(v.aceitas, v.decididas),
        }))
        /**
         * Ordenado pela receita aceita, e **com desempate pelo número de
         * propostas**.
         *
         * Sem o desempate, os itens que nunca fecharam — receita zero, que são
         * muitos — sairiam em ordem arbitrária do `Map`, e a lista mudaria de
         * ordem entre duas aberturas da mesma tela sem nada ter mudado.
         */
        .sort((a, b) => {
            const ra = a.receita[0]?.total ?? 0
            const rb = b.receita[0]?.total ?? 0
            if (rb !== ra) return rb - ra
            if (b.propostas !== a.propostas) return b.propostas - a.propostas
            return a.descricao.localeCompare(b.descricao, 'pt-BR')
        })
}

// ──────────────────────────── funil ────────────────────────────

/** Uma passagem de etapa, de `DealStageEntry`. */
export interface PassagemParaMetrica {
    dealId: string
    stageId: string
    stageName: string
    stageOrder: number
    entrouEm: Date
}

export interface LinhaDeEtapa {
    stageId: string
    nome: string
    ordem: number
    /** Quantos negócios passaram por aqui no período. */
    passaram: number
    /** Dias nesta etapa: a mediana é o número que se lê. */
    diasMediana: number | null
    diasMedia: number | null
}

/**
 * Quanto tempo o negócio fica em cada etapa.
 *
 * O cálculo precisa da passagem SEGUINTE do mesmo negócio para saber quando ele
 * saiu — é o `lead() over (partition by dealId order by enteredAt)` que
 * `lib/dashboard/charts.ts` faz em SQL cru. Aqui a mesma conta é feita em
 * memória, de propósito: o relatório recorta por período e por responsável, e
 * replicar esses filtros dentro de uma janela SQL seria um terceiro lugar onde
 * a regra de visibilidade pode divergir.
 *
 * **A última passagem de cada negócio não conta.** Ele ainda está lá, e medir
 * "até agora" misturaria tempo decorrido com tempo gasto: um negócio aberto há
 * seis meses na primeira etapa inflaria a mediana de uma etapa pela qual todos
 * passam em um dia.
 */
export function metricasDeEtapas(
    passagens: readonly PassagemParaMetrica[]
): LinhaDeEtapa[] {
    const porNegocio = new Map<string, PassagemParaMetrica[]>()
    for (const p of passagens) {
        const lista = porNegocio.get(p.dealId) ?? []
        lista.push(p)
        porNegocio.set(p.dealId, lista)
    }

    const diasPorEtapa = new Map<string, { nome: string; ordem: number; dias: number[]; passaram: number }>()

    for (const lista of porNegocio.values()) {
        const ordenada = [...lista].sort((a, b) => a.entrouEm.getTime() - b.entrouEm.getTime())
        for (let i = 0; i < ordenada.length; i++) {
            const atual = ordenada[i]
            const acc =
                diasPorEtapa.get(atual.stageId) ??
                { nome: atual.stageName, ordem: atual.stageOrder, dias: [], passaram: 0 }
            acc.passaram += 1

            const seguinte = ordenada[i + 1]
            if (seguinte) {
                const dias = (seguinte.entrouEm.getTime() - atual.entrouEm.getTime()) / DIA_EM_MS
                if (dias >= 0) acc.dias.push(dias)
            }
            diasPorEtapa.set(atual.stageId, acc)
        }
    }

    return [...diasPorEtapa.entries()]
        .map(([stageId, v]) => ({
            stageId,
            nome: v.nome,
            ordem: v.ordem,
            passaram: v.passaram,
            diasMediana: arredondarOuNulo(mediana(v.dias), 1),
            diasMedia: arredondarOuNulo(media(v.dias), 1),
        }))
        // Na ordem do funil, não na da contagem: o relatório se lê como o funil
        // se percorre, e é isso que mostra ONDE ele vaza.
        .sort((a, b) => a.ordem - b.ordem)
}

/** Onde o funil vaza: negócios perdidos pela etapa em que estavam ao fechar. */
export interface LinhaDePerda {
    stageId: string | null
    nome: string
    perdidos: number
    /** O valor que saiu por aqui, por moeda. */
    valor: QuantiaPorMoeda[]
    motivos: { nome: string; quantos: number }[]
}

export function metricasDePerdas(
    perdidos: readonly {
        closedStageId: string | null
        closedStageName: string | null
        motivo: string | null
        moeda: string
        valor: number
    }[]
): LinhaDePerda[] {
    const por = new Map<
        string,
        { stageId: string | null; nome: string; quantos: number; valores: { moeda: string; valor: number }[]; motivos: Map<string, number> }
    >()

    for (const p of perdidos) {
        const chave = p.closedStageId ?? 'sem-etapa'
        const atual =
            por.get(chave) ??
            {
                stageId: p.closedStageId,
                // Fechado sem etapa registrada é o negócio anterior ao
                // `closedStageId` existir. Dizer "não registrada" é melhor que
                // escondê-lo: ele faz parte do total.
                nome: p.closedStageName ?? 'Etapa não registrada',
                quantos: 0,
                valores: [],
                motivos: new Map<string, number>(),
            }
        atual.quantos += 1
        atual.valores.push({ moeda: p.moeda, valor: p.valor })
        const motivo = p.motivo ?? 'Sem motivo informado'
        atual.motivos.set(motivo, (atual.motivos.get(motivo) ?? 0) + 1)
        por.set(chave, atual)
    }

    return [...por.values()]
        .map((v) => ({
            stageId: v.stageId,
            nome: v.nome,
            perdidos: v.quantos,
            valor: somarPorMoeda(v.valores),
            motivos: [...v.motivos.entries()]
                .map(([nome, quantos]) => ({ nome, quantos }))
                .sort((a, b) => b.quantos - a.quantos || a.nome.localeCompare(b.nome, 'pt-BR')),
        }))
        .sort((a, b) => b.perdidos - a.perdidos || a.nome.localeCompare(b.nome, 'pt-BR'))
}
