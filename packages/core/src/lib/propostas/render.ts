/**
 * O documento em HTML — a mesma função para a prévia e para o que o cliente vê.
 *
 * ## O único render
 *
 * Prévia no editor, página pública, hash do aceite, impressão: tudo passa por
 * `renderDocumento`. Dois renders divergiriam num centavo ou numa vírgula, e o
 * hash gravado no aceite deixaria de corresponder ao que a pessoa viu. Por isso
 * o modo Visualizar do editor **busca o HTML pronto** do servidor em vez de
 * reimplementar isto no navegador — e por isso este módulo não entra no bundle
 * do cliente (importa `calculo.ts`, que importa o Prisma; ver regra 7 de
 * `check-marca.mjs`).
 *
 * ## Duas entradas, uma saída
 *
 * O documento chega como **seções** (`secoes.ts`, a v2) ou como **corpo de
 * texto** (a v1). O corpo é convertido em seções pela mesma função que a
 * migração usa, então os dois caminhos passam pelo mesmo código — e o
 * verificador prova que o render do corpo e o render da sua conversão são
 * idênticos byte a byte.
 *
 * ## O que o HTML carrega, e o que não carrega
 *
 * Só classes `doc-*` e tags semânticas. Nenhum estilo inline, nenhum script: o
 * CSS mora na página que o exibe (a pública tem o de impressão). Todo texto que
 * vem de fora passa por `esc()`; a única exceção é a tabela de itens, montada
 * aqui com valores já formatados.
 *
 * Seção de **página** (`ehPagina`) sai dentro de `<section class="doc-pagina">`,
 * que o CSS de impressão quebra em folha nova.
 */
import { dinheiroEmTexto, quantidadeEmTexto, type TotaisDaRevisao } from './calculo'
import { converterCorpoEmSecoes, ehPagina, ROTULO_DA_SECAO, secoesPadrao, type Secao, type TipoDeSecao } from './secoes'
import { lerTema } from './tema'
import { aplicarVariaveis, MARCADOR_DE_ITENS, type ContextoDeVariaveis } from './variaveis'

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
    /**
     * A logomarca da organização, como URL. Nula quando não há.
     *
     * Entra **dentro** do HTML do documento, e essa é a mudança: ela já chegava
     * à página pública, mas desenhada ao lado do documento, não nele. Ao lado,
     * ela não existe no PDF — e o PDF é o que o cliente guarda e reencaminha.
     */
    logo?: string | null
    /**
     * O `theme` do modelo, cru. Quem o lê é `lerTema`; aqui ele só atravessa,
     * porque o render precisa saber duas coisas dele: se a capa é escura e se a
     * logomarca deve aparecer.
     */
    tema?: unknown
    /**
     * A linha que se repete no cabeçalho de toda folha impressa, à direita da
     * marca. Algo como "Proposta comercial · Fulano".
     */
    rotuloCorrido?: string | null
    /** O rodapé impresso, à esquerda. O nome da organização, em geral. */
    rodapeCorrido?: string | null
    /**
     * As seções da v2. Quando vêm, mandam.
     *
     * Sem elas, `corpo` é convertido; sem os dois, entra o padrão.
     */
    secoes?: readonly Secao[] | null
    /** O corpo do template da v1, com marcadores. */
    corpo?: string | null
    variaveis: ContextoDeVariaveis
    itens: readonly ItemParaRender[]
    totais: Pick<TotaisDaRevisao, 'subtotal' | 'discount' | 'total'>
    moeda: string
    /** URL pública da arte da capa, quando a seção `capa` tem `imageKey`. */
    urlDaCapa?: string | null
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
 * Texto livre de uma seção → HTML, já com as variáveis.
 *
 * A ordem importa: os marcadores são trocados **no texto cru** e só então o
 * texto vira HTML escapado. Invertê-la permitiria que o valor de uma variável
 * — o nome de um contato — carregasse HTML para dentro do documento.
 */
function textoEmHtml(texto: string, ctx: ContextoDeVariaveis): string {
    return corpoEmHtml(aplicarVariaveis(texto, ctx))
}

/** Uma linha curta (título, rótulo), com variáveis e escapada. */
function linha(texto: string | null | undefined, ctx: ContextoDeVariaveis): string {
    return esc(aplicarVariaveis(texto ?? '', ctx).trim())
}

/** `<h2>` opcional de uma seção de bloco. */
function tituloDaSecao(titulo: string | null | undefined, ctx: ContextoDeVariaveis): string {
    const t = linha(titulo, ctx)
    return t ? `<h2>${t}</h2>\n` : ''
}

/**
 * Uma seção → HTML.
 *
 * Cada tipo tem a sua forma, e a forma é fixa: a organização preenche campos,
 * não layout. É o contrato que faz editor, link e impressão saírem iguais.
 */
function secaoEmHtml(s: Secao, doc: DocumentoParaRender): string {
    const ctx = doc.variaveis
    switch (s.tipo) {
        case 'texto':
            return tituloDaSecao(s.titulo, ctx) + textoEmHtml(s.corpo, ctx)

        case 'itens':
            return tituloDaSecao(s.titulo, ctx) + tabelaDeItens(doc.itens, doc.totais, doc.moeda)

        case 'condicoes':
            return tituloDaSecao(s.titulo ?? 'Condições', ctx) + textoEmHtml(s.corpo, ctx)

        case 'carta':
            return tituloDaSecao(s.titulo, ctx) + textoEmHtml(s.corpo, ctx)

        case 'capa': {
            const imagem =
                s.imageKey && doc.urlDaCapa
                    ? `<img class="doc-capa-arte" src="${esc(doc.urlDaCapa)}" alt="">\n` +
                      /**
                       * O véu entre a arte e o texto — **só quando há arte**.
                       *
                       * A imagem vem de IA e pode sair escura; o título usa a
                       * tinta do tema. Sem esta camada, capa escura com texto
                       * escuro fica ilegível, e isso não depende de ninguém
                       * errar: depende do que o modelo de imagem sortear.
                       * Capa sem arte não precisa dele, e aí ele não entra.
                       */
                      `<div class="doc-capa-veu" aria-hidden="true"></div>\n`
                    : ''
            const titulo = linha(s.titulo ?? '{{documento.titulo}}', ctx)
            const subtitulo = linha(s.subtitulo, ctx)
            /**
             * **A logomarca NÃO entra aqui**, e o verificador me pegou tentando.
             *
             * O endereço do logo é da conta e muda sozinho; o HTML do documento
             * é o que o aceite hasheia. Logo dentro do HTML faria o hash de um
             * documento já aceito deixar de bater no dia em que alguém trocasse
             * a marca. Ela vive na moldura impressa (`chromeDoDocumento`), que
             * fica fora do que se hasheia — ver `publico.ts`.
             */
            return (
                imagem +
                `<div class="doc-capa-texto">` +
                `<p class="doc-capa-organizacao">${linha('{{organizacao.nome}}', ctx)}</p>` +
                `<h1 class="doc-capa-titulo">${titulo}</h1>` +
                (subtitulo ? `<p class="doc-capa-subtitulo">${subtitulo}</p>` : '') +
                `<p class="doc-capa-rodape"><span>${linha('{{cliente.nome}}', ctx)}</span>` +
                `<span>${linha('{{documento.data}}', ctx)}</span>` +
                `<span>${linha('{{documento.numero}}', ctx)}</span></p>` +
                `</div>`
            )
        }

        case 'sumario':
            // Montado por quem chama, que conhece a lista inteira — ver
            // `renderDocumento`. Aqui é só a âncora.
            return ''

        case 'destaques':
            return (
                tituloDaSecao(s.titulo, ctx) +
                `<ul class="doc-destaques">` +
                s.itens
                    .map(
                        (d) =>
                            `<li><strong class="doc-destaque-valor">${linha(d.valor, ctx)}</strong>` +
                            `<span class="doc-destaque-rotulo">${linha(d.rotulo, ctx)}</span>` +
                            (d.legenda ? `<span class="doc-destaque-legenda">${linha(d.legenda, ctx)}</span>` : '') +
                            `</li>`
                    )
                    .join('') +
                `</ul>`
            )

        case 'escopo':
            return (
                tituloDaSecao(s.titulo ?? 'Escopo', ctx) +
                `<ul class="doc-cartoes">` +
                s.cartoes
                    .map((c) => `<li><h3>${linha(c.titulo, ctx)}</h3>${textoEmHtml(c.descricao, ctx)}</li>`)
                    .join('') +
                `</ul>`
            )

        case 'fases':
            return (
                tituloDaSecao(s.titulo ?? 'Fases', ctx) +
                `<ol class="doc-fases">` +
                s.fases
                    .map(
                        (f) =>
                            `<li><h3>${linha(f.nome, ctx)}</h3>` +
                            (f.prazo ? `<p class="doc-fase-prazo">${linha(f.prazo, ctx)}</p>` : '') +
                            textoEmHtml(f.descricao, ctx) +
                            (f.responsavel ? `<p class="doc-fase-resp">Responsável: ${linha(f.responsavel, ctx)}</p>` : '') +
                            `</li>`
                    )
                    .join('') +
                `</ol>`
            )

        case 'investimento':
            return (
                tituloDaSecao(s.titulo ?? 'Investimento', ctx) +
                (s.introducao ? textoEmHtml(s.introducao, ctx) + '\n' : '') +
                `<ul class="doc-precos">` +
                s.cartoes
                    .map(
                        (c) =>
                            `<li><h3>${linha(c.titulo, ctx)}</h3>` +
                            `<p class="doc-preco-valor">${linha(c.valor, ctx)}</p>` +
                            (c.periodo ? `<p class="doc-preco-periodo">${linha(c.periodo, ctx)}</p>` : '') +
                            (c.inclui.length ? `<ul>${c.inclui.map((i) => `<li>${linha(i, ctx)}</li>`).join('')}</ul>` : '') +
                            `</li>`
                    )
                    .join('') +
                `</ul>`
            )

        case 'garantia':
            return (
                tituloDaSecao(s.titulo ?? 'Garantia e bônus', ctx) +
                `<ul class="doc-garantias">` +
                s.blocos.map((b) => `<li><h3>${linha(b.titulo, ctx)}</h3>${textoEmHtml(b.texto, ctx)}</li>`).join('') +
                `</ul>`
            )

        case 'aceite':
            return (
                `<div class="doc-aceite">` +
                textoEmHtml(
                    s.texto ??
                        'Ao aceitar este documento, {{cliente.nome}} confirma ter lido e concordado com as condições acima.',
                    ctx
                ) +
                `<p class="doc-aceite-resp">${linha('{{responsavel.nome}}', ctx)} — ${linha('{{organizacao.nome}}', ctx)}</p>` +
                `</div>`
            )

        case 'fechamento':
            return (
                tituloDaSecao(s.titulo, ctx) +
                textoEmHtml(s.corpo, ctx) +
                (s.chamada ? `\n<p class="doc-chamada">${linha(s.chamada, ctx)}</p>` : '') +
                `\n<p class="doc-contato">${linha('{{responsavel.nome}}', ctx)}` +
                ` · ${linha('{{responsavel.email}}', ctx)}` +
                ` · ${linha('{{responsavel.telefone}}', ctx)}</p>`
            )
    }
}

/** O título que uma seção teria no sumário, se tiver. */
function tituloParaSumario(s: Secao, ctx: ContextoDeVariaveis): string | null {
    if (s.tipo === 'capa' || s.tipo === 'sumario') return null
    if ('titulo' in s && s.titulo) return linha(s.titulo, ctx)
    const padrao: Partial<Record<Secao['tipo'], string>> = {
        itens: 'Itens e valores',
        condicoes: 'Condições',
        escopo: 'Escopo',
        fases: 'Fases',
        investimento: 'Investimento',
        garantia: 'Garantia e bônus',
        aceite: 'Aceite',
    }
    return padrao[s.tipo] ?? null
}

/**
 * As seções → o documento inteiro.
 *
 * Página embrulha em `<section class="doc-pagina doc-pagina-<tipo>">`; bloco
 * embrulha em `<section class="doc-secao doc-secao-<tipo>">`. O sumário é
 * montado aqui porque precisa da lista inteira.
 */
/**
 * Os tipos que ganham sobretítulo numerado — "02 — ESCOPO".
 *
 * **Nem todo tipo ganha, e o critério é se o rótulo diz alguma coisa.** Em
 * `escopo` ou `investimento` o rótulo nomeia a parte da venda, e numerá-lo dá
 * ao documento a espinha que a referência do André tem. Em `texto` o rótulo é
 * literalmente "Texto": sobretítulo ali seria ruído com número.
 *
 * O par é rótulo mais título, e eles dizem coisas diferentes de propósito: o
 * rótulo é a etiqueta da seção, o título é a frase daquele documento. Sai de
 * dado que já existe, sem campo novo no schema.
 */
const COM_SOBRETITULO: ReadonlySet<TipoDeSecao> = new Set([
    'destaques',
    'escopo',
    'fases',
    'investimento',
    'garantia',
    'condicoes',
])

/**
 * `itens` ficou **fora** da lista, e não por estética.
 *
 * A conversão do corpo da v1 produz exatamente dois tipos, `texto` e `itens`, e
 * o verificador exige que o render do corpo antigo e o render da sua conversão
 * sejam idênticos byte a byte. Um sobretítulo em `itens` quebra essa igualdade
 * — foi o que ele acusou quando eu o incluí. A etiqueta de dinheiro da
 * referência é `investimento`, que está na lista; a tabela crua não precisa de
 * numeração.
 */

export function renderSecoes(secoes: readonly Secao[], doc: DocumentoParaRender): string {
    const partes: string[] = []
    let numero = 0
    for (const s of secoes) {
        let html: string
        if (s.tipo === 'sumario') {
            const titulos = secoes.map((o) => tituloParaSumario(o, doc.variaveis)).filter((t): t is string => !!t)
            html = `<h2>Sumário</h2>\n<ol class="doc-sumario">${titulos.map((t) => `<li>${t}</li>`).join('')}</ol>`
        } else {
            html = secaoEmHtml(s, doc)
        }
        let sobretitulo = ''
        if (COM_SOBRETITULO.has(s.tipo)) {
            numero += 1
            const n = String(numero).padStart(2, '0')
            sobretitulo = `<p class="doc-sobretitulo">${n} — ${esc(ROTULO_DA_SECAO[s.tipo])}</p>\n`
        }

        /**
         * Nenhum atributo vindo do tema aqui, pela mesma razão da marca: tema é
         * da conta e o HTML é o que se hasheia. Capa clara ou escura é decidida
         * no CSS, que já recebe o tema — ver `cssDoDocumento`.
         */
        const classe = ehPagina(s.tipo) ? `doc-pagina doc-pagina-${s.tipo}` : `doc-secao doc-secao-${s.tipo}`
        partes.push(
            `<section class="${classe}" data-secao="${esc(s.id)}">\n${sobretitulo}${html}\n</section>`
        )
    }
    return partes.join('\n')
}

/**
 * O documento inteiro, em HTML.
 *
 * Seções quando vêm; senão o corpo da v1 convertido; senão o padrão. Um
 * caminho só a partir daqui.
 */
export function renderDocumento(doc: DocumentoParaRender): string {
    const secoes =
        doc.secoes && doc.secoes.length > 0
            ? doc.secoes
            : (() => {
                  const convertidas = converterCorpoEmSecoes(doc.corpo)
                  return convertidas.length > 0 ? convertidas : secoesPadrao()
              })()
    return renderSecoes(secoes, doc)
}

/**
 * O cabeçalho e o rodapé que se repetem em **toda folha impressa**.
 *
 * Escondidos na tela: a página pública rola, e já tem o cabeçalho dela. Na
 * impressão o CSS os põe em `position: fixed` dentro da margem da folha, que é
 * o que o Chromium repete por página.
 *
 * **Fica FORA do HTML que se hasheia.** A marca e o rótulo vêm da conta e do
 * cliente, não do documento; dentro do `renderDocumento` eles fariam o hash de
 * um documento já aceito mudar quando alguém trocasse a logomarca. Quem a
 * desenha é a página, dentro do mesmo escopo de CSS e ao lado do documento.
 *
 * **O que não tem, e é diferença visível para a referência:** o "03 / 05". A
 * numeração de página em CSS mora nas margin boxes (`@bottom-right`), e o
 * Chromium não as implementa. Sair disso exige paginar o documento em folhas
 * explícitas, que é outra decisão — ver o estudo de 27/11/2026. Preferi a
 * ausência à numeração errada.
 */
export function chromeDoDocumento(doc: Pick<DocumentoParaRender, 'logo' | 'tema' | 'rotuloCorrido' | 'rodapeCorrido'>): string {
    const tema = lerTema(doc.tema)
    const marca =
        doc.logo && tema.logo ? `<img src="${esc(doc.logo)}" alt="">` : ''
    const rotulo = doc.rotuloCorrido ? esc(doc.rotuloCorrido) : ''
    const rodape = doc.rodapeCorrido ? esc(doc.rodapeCorrido) : ''

    if (!marca && !rotulo && !rodape) return ''

    return (
        `<div class="doc-chrome doc-chrome-topo" aria-hidden="true">` +
        `<span class="doc-chrome-marca">${marca}</span><span>${rotulo}</span></div>\n` +
        `<div class="doc-chrome doc-chrome-rodape" aria-hidden="true">` +
        `<span>${rodape}</span><span></span></div>\n`
    )
}

/**
 * O corpo da v1, renderizado como a v1 renderizava — **sem** as seções.
 *
 * Existe para o verificador: é o oráculo contra o qual `renderDocumento` do
 * mesmo corpo é comparado byte a byte, descontados os embrulhos `<section>`.
 * Não é usado por nenhuma rota.
 */
export function renderCorpoLegado(doc: Omit<DocumentoParaRender, 'secoes'>): string {
    const corpo = (doc.corpo ?? '').trim()
    const comVariaveis = aplicarVariaveis(corpo, doc.variaveis)
    const marcadorDeItens = new RegExp(`\\{\\{\\s*${MARCADOR_DE_ITENS}\\s*(?:\\|[^}]*)?\\}\\}`, 'g')
    const reserva = '[[ITENS]]'
    const comReserva = comVariaveis.replace(marcadorDeItens, () => `\n\n${reserva}\n\n`)
    const html = corpoEmHtml(comReserva)
    return html.split(`<p>${reserva}</p>`).join(tabelaDeItens(doc.itens, doc.totais, doc.moeda))
}

/** Tira os embrulhos `<section>` para comparar o miolo com o render legado. */
export function miolo(html: string): string {
    return html
        .replace(/<section class="[^"]*" data-secao="[^"]*">\n?/g, '')
        .replace(/\n?<\/section>/g, '')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .join('\n')
}
