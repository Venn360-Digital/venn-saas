import type { Secao } from './secoes'

/**
 * Tabela de planilha → seção estruturada, sem IA.
 *
 * ## Por que em código, e não no prompt
 *
 * `extrairTextoDeXlsx` entrega uma aba como `## Nome` seguido de linhas com
 * células separadas por tabulação. Pedir à IA que "reconheça a tabela de
 * preços" funcionava às vezes — e às vezes a tabela virava um parágrafo. Uma
 * tabela é estrutura explícita; o que é explícito se lê em código, e o que se
 * lê em código se testa.
 *
 * ## O que vira o quê
 *
 * Uma aba com linhas de 2+ células e uma coluna de dinheiro vira:
 * - **investimento** (cartões) quando tem até 4 linhas de dados — título na
 *   primeira célula, valor na coluna de dinheiro, o resto em "inclui";
 * - **texto** com uma lista quando tem mais, porque quatro é o teto de cartões
 *   que cabem lado a lado, e uma lista de vinte preços não é vitrine.
 *
 * Aba sem coluna de dinheiro fica no texto que vai à IA, como antes.
 *
 * Os valores ficam **como estão**: é documento da organização, e esvaziar
 * compromisso é regra da IA que monta, não do importador (ver `modelo-ia.ts`).
 */

const DINHEIRO = /(?:R\$\s?)?-?\d{1,3}(?:\.\d{3})*(?:,\d{2})\b|(?:R\$\s?)-?\d+(?:[.,]\d{2})?\b/

// A célula INTEIRA é a palavra de cabeçalho: "Item 3" é dado, "Item" é cabeçalho.
const CABECALHO = /^(descri[cç][aã]o|item|itens|servi[cç]os?|produtos?|planos?|pacotes?|valor|pre[cç]o|total|qtd|quantidade|unid|unidade|per[ií]odo)$/i

function colunaDeDinheiro(linhas: string[][]): number {
    const larg = Math.max(...linhas.map((l) => l.length))
    for (let c = larg - 1; c >= 1; c--) {
        const acertos = linhas.filter((l) => l[c] && DINHEIRO.test(l[c])).length
        if (acertos >= Math.max(1, Math.ceil(linhas.length / 2))) return c
    }
    return -1
}

function idDe(prefixo: string, n: number): string {
    return `${prefixo}${n}${Date.now().toString(36).slice(-4)}`
}

export interface TextoSeparado {
    /** O texto sem as tabelas reconhecidas — é o que vai à IA. */
    texto: string
    /** As seções montadas das tabelas, na ordem das abas. */
    secoes: Secao[]
}

export function separarTabelas(texto: string): TextoSeparado {
    const blocos = texto.split(/\n(?=## )/)
    const restantes: string[] = []
    const secoes: Secao[] = []

    blocos.forEach((bloco, n) => {
        const m = bloco.match(/^## (.+)\n([\s\S]*)$/)
        if (!m) {
            restantes.push(bloco)
            return
        }
        const [, nome, corpo] = m
        const linhas = corpo
            .split('\n')
            .map((l) => l.split('\t').map((c) => c.trim()))
            .filter((l) => l.filter(Boolean).length >= 2)
        if (linhas.length < 1) {
            restantes.push(bloco)
            return
        }
        const dados = linhas.filter((l) => !CABECALHO.test(l[0] ?? ''))
        const coluna = dados.length ? colunaDeDinheiro(dados) : -1
        if (coluna < 0) {
            restantes.push(bloco)
            return
        }

        const titulo = nome.trim()
        if (dados.length <= 4) {
            secoes.push({
                id: idDe('inv', n),
                tipo: 'investimento',
                titulo,
                cartoes: dados.map((l) => ({
                    titulo: (l[0] ?? '').slice(0, 200),
                    valor: (l[coluna] ?? '').slice(0, 200),
                    periodo: null,
                    inclui: l.filter((c, i) => i !== 0 && i !== coluna && c).map((c) => c.slice(0, 200)).slice(0, 12),
                })),
            })
        } else {
            secoes.push({
                id: idDe('tab', n),
                tipo: 'texto',
                titulo,
                corpo: dados.map((l) => `- ${l[0]} — ${l[coluna]}${l.filter((c, i) => i !== 0 && i !== coluna && c).length ? ` (${l.filter((c, i) => i !== 0 && i !== coluna && c).join(', ')})` : ''}`).join('\n'),
            })
        }
        restantes.push(`## ${titulo}\n[tabela de ${dados.length} linha(s), já lida como seção]`)
    })

    return { texto: restantes.join('\n'), secoes }
}
