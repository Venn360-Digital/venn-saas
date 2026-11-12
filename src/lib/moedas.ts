/**
 * A moeda em que o sistema mostra dinheiro.
 *
 * Até 2026-11-03 todo valor da aplicação era `R$` escrito à mão ou um
 * `Intl.NumberFormat('pt-BR', { currency: 'BRL' })` recriado em sete arquivos.
 * Funcionava enquanto todo cliente fosse brasileiro; uma clínica que fecha
 * tratamento em dólar ou euro via o símbolo errado em cima do número certo,
 * que é pior que não mostrar símbolo nenhum.
 *
 * ESCOPO: a moeda é **da conta**, não da unidade.
 *
 * A guia que a edita é a da Conta, e o dashboard soma negócios de unidades
 * irmãs na mesma coluna — duas moedas dentro de uma conta fariam a soma mentir.
 * Uma conta, uma moeda, como a logomarca.
 *
 * O QUE ELA **NÃO** TOCA: a cobrança da plataforma.
 *
 * Decisão do Andre em 2026-11-03. Plano, faturas e checkout continuam em BRL
 * porque é o que o Asaas liquida e é a moeda da tabela de preços — pintar `€`
 * sobre "490" anunciaria um preço que não é o debitado. Por isso `plans.ts`,
 * `PlanoTab` e `lib/asaas/*` seguem com o formatador fixo em real, de propósito.
 *
 * TROCAR A MOEDA NÃO CONVERTE VALOR.
 *
 * Um negócio de 50.000 passa a ler `$ 50,000.00`, não `$ 8.300`. Converter
 * exigiria cotação do dia do fechamento de cada registro — e, sem isso, uma
 * conversão "ajudando" reescreveria o histórico comercial com um número que
 * ninguém negociou. A tela diz isso ao lado do campo.
 */

export interface Moeda {
    /** ISO 4217, que é o que o `Intl` aceita e o que o banco guarda. */
    codigo: string
    nome: string
    /**
     * A locale que pontua o número.
     *
     * A de cada moeda, não a da interface: quem escolhe dólar espera
     * `$1,234.56`, com vírgula de milhar e ponto decimal, e não o
     * `US$ 1.234,56` que o `pt-BR` produziria. Para `BRL` dá no mesmo que
     * antes, que é o caso da esmagadora maioria das contas.
     */
    locale: string
}

export const MOEDA_PADRAO = 'BRL'

/**
 * As dez mais negociadas do mundo (volume diário do BIS) mais o real.
 *
 * O real não entra por ser grande — entra por ser o padrão e o de toda conta
 * que já existe. As outras dez são a lista do Andre ("as 10 maiores"), na
 * ordem do volume: dólar, euro, iene, libra, yuan, dólar australiano, dólar
 * canadense, franco suíço, dólar de Hong Kong e dólar de Singapura.
 */
export const MOEDAS: readonly Moeda[] = [
    { codigo: 'BRL', nome: 'Real brasileiro', locale: 'pt-BR' },
    { codigo: 'USD', nome: 'Dólar americano', locale: 'en-US' },
    { codigo: 'EUR', nome: 'Euro', locale: 'pt-PT' },
    { codigo: 'JPY', nome: 'Iene japonês', locale: 'ja-JP' },
    { codigo: 'GBP', nome: 'Libra esterlina', locale: 'en-GB' },
    { codigo: 'CNY', nome: 'Yuan chinês', locale: 'zh-CN' },
    { codigo: 'AUD', nome: 'Dólar australiano', locale: 'en-AU' },
    { codigo: 'CAD', nome: 'Dólar canadense', locale: 'en-CA' },
    { codigo: 'CHF', nome: 'Franco suíço', locale: 'de-CH' },
    { codigo: 'HKD', nome: 'Dólar de Hong Kong', locale: 'zh-HK' },
    { codigo: 'SGD', nome: 'Dólar de Singapura', locale: 'en-SG' },
] as const

/** Os códigos aceitos, para o Zod e o `<select>` não repetirem a lista. */
export const CODIGOS_DE_MOEDA = MOEDAS.map((m) => m.codigo)

/**
 * A moeda de um código, com o real como rede.
 *
 * Nunca lança: o código vem do banco, e uma conta gravada com um código que
 * saiu da lista deve continuar abrindo a tela em real em vez de derrubá-la.
 */
export function moedaDe(codigo: string | null | undefined): Moeda {
    return MOEDAS.find((m) => m.codigo === codigo) ?? MOEDAS[0]
}

/**
 * Os formatadores, criados uma vez por combinação.
 *
 * `new Intl.NumberFormat` é caro o bastante para doer num gráfico que o chama
 * por marca do eixo — era por isso que cada arquivo guardava o seu numa
 * constante de módulo. Aqui a constante virou mapa porque a moeda deixou de ser
 * conhecida em tempo de compilação.
 */
const cache = new Map<string, Intl.NumberFormat>()

function formatador(codigo: string, opcoes: Intl.NumberFormatOptions): Intl.NumberFormat {
    const moeda = moedaDe(codigo)
    const chave = `${moeda.codigo}|${JSON.stringify(opcoes)}`
    const pronto = cache.get(chave)
    if (pronto) return pronto

    /**
     * Fora do ICU completo, uma locale desconhecida faz o `Intl` cair para a do
     * ambiente em vez de lançar — mas um código de moeda inválido **lança**.
     * O `catch` devolve o real formatado, que é um número legível com o símbolo
     * errado, em vez de uma tela em branco.
     */
    let novo: Intl.NumberFormat
    try {
        novo = new Intl.NumberFormat(moeda.locale, {
            style: 'currency',
            currency: moeda.codigo,
            ...opcoes,
        })
    } catch {
        novo = new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: MOEDA_PADRAO,
            ...opcoes,
        })
    }

    cache.set(chave, novo)
    return novo
}

/** "R$ 1.234,56", "$1,234.56", "￥1,235". O valor vem na unidade inteira. */
export function formatarMoeda(valor: number, codigo: string): string {
    return formatador(codigo, {}).format(valor)
}

/**
 * Sem centavos: "R$ 1.235". Para onde a casa decimal só faz ruído.
 *
 * É o formato que o painel usava — os cartões e os eixos somam dezenas de
 * milhares, e ali os centavos ocupam espaço sem informar.
 */
export function formatarMoedaInteira(valor: number, codigo: string): string {
    return formatador(codigo, { maximumFractionDigits: 0 }).format(valor)
}

/**
 * "R$ 41,8 mil", "$41.8K" — o eixo não comporta "R$ 41.800" em cada marca.
 *
 * `notation: 'compact'` em vez do `(valor / 1000).toFixed(1) + ' mil'` que
 * estava escrito à mão: o sufixo de milhar não é "mil" em inglês nem em
 * japonês, e dividir por mil num idioma que agrupa de quatro em quatro dígitos
 * produz um rótulo que não existe.
 *
 * Abaixo de mil continua escrito por extenso: "R$ 840" cabe no eixo e
 * "R$ 0,84 mil" seria uma compactação que atrapalha.
 */
export function formatarMoedaCompacta(valor: number, codigo: string): string {
    if (Math.abs(valor) < 1000) return formatarMoedaInteira(valor, codigo)
    return formatador(codigo, {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(valor)
}

/**
 * Quantas casas decimais a moeda tem de verdade.
 *
 * Dois na quase totalidade, **zero no iene**: um campo que guarda "centavos"
 * precisa saber disso, senão ¥ 5.000 é gravado e relido como ¥ 50. O `Intl` é
 * quem sabe — a tabela do ISO 4217 vive dentro dele e não aqui.
 */
export function casasDecimais(codigo: string): number {
    return formatador(codigo, {}).resolvedOptions().maximumFractionDigits ?? 2
}

/**
 * A menor unidade → a unidade inteira. 500000 centavos viram 5000 reais.
 *
 * O campo de preço guarda a menor unidade para não acumular erro de ponto
 * flutuante, e o divisor segue a moeda: 100 onde há centavos, 1 no iene.
 */
export function daMenorUnidade(valor: number, codigo: string): number {
    return valor / 10 ** casasDecimais(codigo)
}

/** O símbolo sozinho — "R$", "$", "€". Para rótulo e placeholder. */
export function simboloDe(codigo: string): string {
    const partes = formatador(codigo, {}).formatToParts(0)
    return partes.find((p) => p.type === 'currency')?.value ?? 'R$'
}

/**
 * O separador decimal da moeda: "," no real, "." no dólar.
 *
 * Existe porque os campos de preço são digitados, e o que se digita tem de
 * casar com o que se lê. O painel de produto mostrava `180,00` e pedia
 * `180,00` de volta — certo em real, errado em dólar, onde a tela passa a
 * escrever `$180.00` e quem copia o formato digita `180.00`. O `parsePrice`
 * antigo descartava pontos como separador de milhar, então `180.00` entrava
 * como **18000**: o preço do serviço multiplicado por cem, gravado sem erro
 * nenhum na tela.
 */
export function separadorDecimal(codigo: string): string {
    const partes = formatador(codigo, {}).formatToParts(1.1)
    return partes.find((p) => p.type === 'decimal')?.value ?? ','
}

/** O número como se digita nesta moeda: "180,00" em real, "180.00" em dólar. */
export function textoDePreco(valor: number | null | undefined, codigo: string): string {
    if (valor == null) return ''
    return valor.toFixed(casasDecimais(codigo)).replace('.', separadorDecimal(codigo))
}

/**
 * O que a pessoa digitou → número, na pontuação desta moeda.
 *
 * Tudo que não é dígito, sinal ou o separador decimal **desta** moeda cai
 * fora — o que inclui o separador de milhar, seja ele ponto, vírgula, espaço
 * ou o apóstrofo suíço. É o que torna `1.234,56` e `1,234.56` lidos como o
 * mesmo número, cada um na sua moeda.
 */
export function precoDoTexto(texto: string, codigo: string): number | null {
    if (!texto.trim()) return null
    const decimal = separadorDecimal(codigo)
    const limpo = texto
        .replace(new RegExp(`[^0-9\\-${decimal === '.' ? '\\.' : decimal}]`, 'g'), '')
        .replace(decimal, '.')
    const n = parseFloat(limpo)
    return Number.isFinite(n) ? n : null
}
