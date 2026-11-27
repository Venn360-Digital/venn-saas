/**
 * A soma de uma proposta — a função que o servidor usa e o cliente não.
 *
 * ## Por que isto é puro e mora sozinho
 *
 * O cálculo não toca banco, não lê sessão e não sabe o que é workspace. É de
 * propósito: é o único jeito de exercitá-lo sem Postgres e sem Cloudflare, no
 * `scripts/check-propostas.ts`. A mesma separação de `lib/funil/passos.ts`.
 *
 * ## O total NUNCA vem do navegador
 *
 * A tela manda a lista de itens; o servidor devolve a soma. Aceitar o total que
 * o cliente mandou é aceitar um desconto que ninguém aprovou — e num documento
 * que o cliente final vai aceitar, isso é dinheiro saindo sem alçada. A segunda
 * linha de defesa é o `CHECK (total = subtotal - discount)` na migração, para o
 * dia em que um caminho de código novo gravar sem passar por aqui.
 *
 * ## Dinheiro é `Decimal`, e a conta fecha em DUAS casas
 *
 * As colunas são `Decimal(18,4)` para acomodar preço unitário fracionado —
 * R$ 2,4567 por ml de anestésico é preço real. Mas **cada linha do documento é
 * arredondada a dois** antes de somar, e não depois.
 *
 * A ordem importa e foi escolhida: somar os valores exatos e arredondar o total
 * no fim produz um documento em que as linhas, somadas pelo cliente na
 * calculadora, não dão o total impresso — por um ou dois centavos. Quem recebe
 * uma proposta soma as linhas. Então quem arredonda é a linha; o total é a soma
 * de números que já estão redondos, e fecha exatamente.
 */
import { Prisma } from '@venn/db'

type Decimal = Prisma.Decimal
const D = Prisma.Decimal

/** Casas do dinheiro que aparece. Ver o cabeçalho: a linha arredonda, não o total. */
export const CASAS_DO_DINHEIRO = 2

/** Meio para cima — o arredondamento comercial. `Prisma.Decimal.ROUND_HALF_UP` é 4. */
const ARREDONDAMENTO = D.ROUND_HALF_UP

/** O que o cálculo precisa saber de um item. Nem id, nem descrição, nem ordem. */
export interface ItemParaCalculo {
    quantity: Decimal | number | string
    unitPrice: Decimal | number | string
    /** Por cento, 0 a 100. O `CHECK` da migração recusa fora da faixa. */
    discountPct: Decimal | number | string
}

/** O que cada linha do documento mostra, depois da conta. */
export interface TotaisDoItem {
    /** `quantidade × preço unitário`, arredondado. O "de" do documento. */
    bruto: Decimal
    /** O desconto em dinheiro desta linha. */
    desconto: Decimal
    /** `bruto − desconto`. É o que vai para `ProposalItem.total`. */
    total: Decimal
}

export interface TotaisDaRevisao {
    subtotal: Decimal
    discount: Decimal
    total: Decimal
    /** Na mesma ordem em que os itens entraram. */
    itens: TotaisDoItem[]
}

function dec(v: Decimal | number | string): Decimal {
    return v instanceof D ? v : new D(v)
}

function emDinheiro(v: Decimal): Decimal {
    return v.toDecimalPlaces(CASAS_DO_DINHEIRO, ARREDONDAMENTO)
}

/**
 * A conta de uma linha.
 *
 * Arredonda o bruto **e** o desconto, separadamente, antes de subtrair. Se só o
 * bruto fosse arredondado, o total da linha herdaria a fração do desconto e
 * voltaria a ter três casas — e a linha deixaria de fechar com o que se lê.
 */
export function calcularItem(item: ItemParaCalculo): TotaisDoItem {
    const bruto = emDinheiro(dec(item.quantity).mul(dec(item.unitPrice)))
    const desconto = emDinheiro(bruto.mul(dec(item.discountPct)).div(100))
    return { bruto, desconto, total: bruto.minus(desconto) }
}

/**
 * A conta da revisão inteira.
 *
 * Lista vazia devolve três zeros — e é o caso normal, não um erro: toda proposta
 * nasce com uma revisão em rascunho e nenhum item.
 */
export function calcularTotais(itens: readonly ItemParaCalculo[]): TotaisDaRevisao {
    const calculados = itens.map(calcularItem)

    const subtotal = calculados.reduce((soma, i) => soma.plus(i.bruto), new D(0))
    const discount = calculados.reduce((soma, i) => soma.plus(i.desconto), new D(0))

    return {
        subtotal,
        discount,
        // `subtotal − discount`, e não a soma dos totais de linha. São iguais por
        // construção (ambos somam números de duas casas), e esta forma é a que o
        // CHECK do banco verifica — escrever a outra deixaria as duas definições
        // convergindo por coincidência em vez de por desenho.
        total: subtotal.minus(discount),
        itens: calculados,
    }
}

/**
 * O dinheiro como texto, para a página pública e o documento.
 *
 * Mora aqui, e não num helper de formatação qualquer, porque o número que se
 * imprime tem de ser o mesmo que se somou: duas casas, sempre, inclusive quando
 * o valor é redondo — "R$ 1.200" num orçamento parece truncado, "R$ 1.200,00"
 * parece um valor.
 */
export function dinheiroEmTexto(valor: Decimal | number | string, moeda = 'BRL'): string {
    const n = Number(emDinheiro(dec(valor)))
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: moeda,
        minimumFractionDigits: CASAS_DO_DINHEIRO,
        maximumFractionDigits: CASAS_DO_DINHEIRO,
    }).format(n)
}

/**
 * A quantidade como texto: inteira quando é inteira.
 *
 * "1 sessão" e não "1,0000 sessão"; mas "0,5 ml" quando a fração existe. O
 * `Decimal(18,4)` da coluna não deve vazar para a tela.
 */
export function quantidadeEmTexto(valor: Decimal | number | string): string {
    const d = dec(valor)
    const casas = d.decimalPlaces()
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: Math.min(casas, 4),
    }).format(Number(d))
}
