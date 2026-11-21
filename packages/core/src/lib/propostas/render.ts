/**
 * O documento em HTML — a mesma função para a prévia e para o que o cliente vê.
 *
 * ## Uma função, dois destinos
 *
 * A prévia na tela do vendedor e a página pública `/p/{token}` chamam **isto**.
 * Duas implementações divergiriam no dia em que alguém mexesse numa só, e a
 * divergência apareceria do pior jeito possível: o vendedor aprovando um
 * documento diferente do que o cliente abriu. É a lição que `lib/email/blocos.ts`
 * já registra — "a prévia na tela é a mesma função do disparo".
 *
 * ## Por que HTML montado aqui, e não um editor rico
 *
 * `EditorDeEmail.tsx` registra a razão, e ela vale igual aqui: **não há
 * sanitizador neste projeto**. HTML colado de fora viraria problema nosso. Então
 * o corpo do template é texto com marcadores, escapado na saída, e o único HTML
 * que sai sem escape é o que esta função monta.
 *
 * O que o template permite é parágrafo, título e lista — reconhecidos por
 * convenção de linha, no espírito do Markdown de `lib/rag/secoes.ts`, não por
 * tag. Quem escreve `<script>` no template vê `&lt;script&gt;` no documento.
 *
 * ## Por que não há PDF aqui
 *
 * Decisão de 2026-11-20: a entrega é a página com `@media print`. O cliente lê
 * no celular, pelo link do WhatsApp, e imprime se quiser papel. O PDF arquivado
 * entra depois, por Browser Rendering, partindo deste mesmo HTML — é a razão de
 * o corpo do template ser HTML e não JSON de blocos.
 */
import { dinheiroEmTexto, quantidadeEmTexto, type TotaisDaRevisao } from './calculo'
import { aplicarVariaveis, MARCADOR_DE_ITENS, type VariaveisDoDocumento } from './variaveis'

/** Escapa o que vai para o HTML. Mesma lista de `lib/email/blocos.ts`. */
export function esc(texto: string): string {
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/** Um item, como o documento o mostra. Valores já congelados na revisão. */
export interface ItemParaRender {
    description: string
    quantity: string | number
    unitPrice: string | number
    discountPct: string | number
    total: string | number
    /** A unidade do catálogo: "sessão", "ml". Opcional. */
    unit?: string | null
}

export interface DocumentoParaRender {
    /** O corpo do template, com marcadores. Vazio cai no corpo padrão. */
    corpo: string | null | undefined
    variaveis: VariaveisDoDocumento
    itens: readonly ItemParaRender[]
    totais: Pick<TotaisDaRevisao, 'subtotal' | 'discount' | 'total'>
    moeda: string
}

/**
 * A tabela de itens.
 *
 * A coluna de desconto só aparece **se algum item tiver desconto**. Uma coluna
 * de zeros em todas as linhas é ruído num documento que o cliente vai ler, e
 * pior: sugere que havia desconto a negociar.
 */
export function tabelaDeItens(
    itens: readonly ItemParaRender[],
    totais: DocumentoParaRender['totais'],
    moeda: string
): string {
    if (itens.length === 0) {
        return '<p class="doc-vazio">Nenhum item.</p>'
    }

    const temDesconto = itens.some((i) => Number(i.discountPct) > 0)

    const cabecalho = [
        '<th class="doc-col-desc">Item</th>',
        '<th class="doc-col-num">Qtd.</th>',
        '<th class="doc-col-num">Valor unit.</th>',
        temDesconto ? '<th class="doc-col-num">Desc.</th>' : '',
        '<th class="doc-col-num">Total</th>',
    ].join('')

    const linhas = itens
        .map((item) => {
            const unidade = item.unit ? ` ${esc(item.unit)}` : ''
            const desconto = temDesconto
                ? `<td class="doc-col-num">${
                      Number(item.discountPct) > 0 ? `${quantidadeEmTexto(item.discountPct)}%` : '&mdash;'
                  }</td>`
                : ''
            return (
                '<tr>' +
                `<td class="doc-col-desc">${esc(item.description)}</td>` +
                `<td class="doc-col-num">${quantidadeEmTexto(item.quantity)}${unidade}</td>` +
                `<td class="doc-col-num">${dinheiroEmTexto(item.unitPrice, moeda)}</td>` +
                desconto +
                `<td class="doc-col-num">${dinheiroEmTexto(item.total, moeda)}</td>` +
                '</tr>'
            )
        })
        .join('')

    // O subtotal e o desconto só aparecem quando há desconto: sem ele, subtotal
    // e total são o mesmo número, e imprimir duas vezes o mesmo valor faz o
    // leitor procurar a diferença que não existe.
    const colunas = temDesconto ? 4 : 3
    const rodape = temDesconto
        ? `<tr class="doc-subtotal"><td colspan="${colunas}">Subtotal</td>` +
          `<td class="doc-col-num">${dinheiroEmTexto(totais.subtotal, moeda)}</td></tr>` +
          `<tr class="doc-subtotal"><td colspan="${colunas}">Desconto</td>` +
          `<td class="doc-col-num">&minus;&nbsp;${dinheiroEmTexto(totais.discount, moeda)}</td></tr>`
        : ''

    return (
        '<table class="doc-itens"><thead><tr>' +
        cabecalho +
        '</tr></thead><tbody>' +
        linhas +
        '</tbody><tfoot>' +
        rodape +
        `<tr class="doc-total"><td colspan="${colunas}">Total</td>` +
        `<td class="doc-col-num">${dinheiroEmTexto(totais.total, moeda)}</td></tr>` +
        '</tfoot></table>'
    )
}

/**
 * O corpo de um template vazio.
 *
 * Existe porque proposta sem template tem de abrir: o vendedor que acabou de
 * instalar o produto não deveria passar pela tela de modelos antes de mandar a
 * primeira. Nenhuma palavra de nicho aqui — o que varia vem pelos marcadores.
 */
const CORPO_PADRAO = `# {{titulo}}

Para: {{cliente}}

Emitido em {{data}}

{{${MARCADOR_DE_ITENS}}}

{{observacao}}`

/**
 * Texto com convenção de linha → HTML.
 *
 * Três formas, e nada mais:
 *   - linha começando com `# ` vira título
 *   - linha começando com `- ` vira item de lista
 *   - o resto vira parágrafo
 *
 * O conteúdo é escapado SEMPRE. A convenção decide a tag; o texto nunca.
 */
function corpoEmHtml(texto: string): string {
    const blocos: string[] = []
    let lista: string[] = []

    const fecharLista = () => {
        if (lista.length > 0) {
            blocos.push(`<ul>${lista.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`)
            lista = []
        }
    }

    for (const linha of texto.split('\n')) {
        const t = linha.trim()
        if (t.length === 0) {
            fecharLista()
            continue
        }
        if (t.startsWith('# ')) {
            fecharLista()
            blocos.push(`<h2>${esc(t.slice(2).trim())}</h2>`)
            continue
        }
        if (t.startsWith('- ')) {
            lista.push(t.slice(2).trim())
            continue
        }
        fecharLista()
        blocos.push(`<p>${esc(t)}</p>`)
    }
    fecharLista()

    return blocos.join('\n')
}

/**
 * Onde a tabela de itens é reservada no texto antes de o HTML ser montado.
 *
 * Precisa ser algo que `corpoEmHtml` trate como um parágrafo inteiro, que
 * `esc()` não altere, e que ninguém escreva num template.
 *
 * **Sem cifrão, de propósito.** A primeira versão usava `$$ITENS$$` e a tabela
 * nunca entrava: numa string de substituição do `replace`, `$$` significa um
 * `$` literal, então a reserva gravada no texto era `$ITENS$` e a troca final
 * procurava outra coisa. O teste pegou. A substituição abaixo também passou a
 * ser uma função, que não interpreta `$` em nenhum caso.
 */
const RESERVA_DE_ITENS = '[[ITENS]]'

/**
 * O documento inteiro, em HTML.
 *
 * A ordem das três etapas importa:
 *   1. os marcadores escalares são trocados **no texto**, ainda cru;
 *   2. o texto vira HTML, com tudo escapado;
 *   3. `{{itens}}` é trocado pela tabela, que é o único HTML não escapado.
 *
 * Trocar 2 e 3 de lugar faria a tabela ser escapada e o cliente ler as tags.
 * Fazer 1 depois de 2 permitiria que um valor de variável — o nome de um
 * contato, por exemplo — carregasse HTML para dentro do documento.
 */
export function renderDocumento(doc: DocumentoParaRender): string {
    const corpo = (doc.corpo ?? '').trim() || CORPO_PADRAO

    const comVariaveis = aplicarVariaveis(corpo, doc.variaveis)

    // O marcador da tabela sai do texto antes de o HTML ser montado, para que
    // ele não termine dentro de um `<p>`: tabela dentro de parágrafo é HTML
    // inválido, e o navegador a move para fora, desmontando a ordem do
    // documento.
    const marcadorDeItens = new RegExp(`\\{\\{\\s*${MARCADOR_DE_ITENS}\\s*(?:\\|[^}]*)?\\}\\}`, 'g')
    // Função de substituição, e não string: string interpretaria `$` — ver a
    // nota em `RESERVA_DE_ITENS`.
    const comReserva = comVariaveis.replace(marcadorDeItens, () => `\n\n${RESERVA_DE_ITENS}\n\n`)

    const html = corpoEmHtml(comReserva)
    const tabela = tabelaDeItens(doc.itens, doc.totais, doc.moeda)

    // A reserva virou um parágrafo próprio: o parágrafo inteiro sai, não só o
    // marcador — senão sobraria `<p></p>` em volta da tabela.
    return html.split(`<p>${RESERVA_DE_ITENS}</p>`).join(tabela)
}
