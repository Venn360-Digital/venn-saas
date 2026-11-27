/**
 * A identidade visual de um modelo: acentos, fonte, capa e logomarca.
 *
 * ## Por que deixou de ser uma cor
 *
 * O tema guardava um campo, `cor`, e dele saíam três tons da mesma matiz. Isso
 * rende um documento coerente e chapado: tudo é a mesma cor mais clara ou mais
 * escura.
 *
 * A proposta que o André tomou como referência em 27/11/2026 usa **três
 * acentos** de propósito — laranja, azul e roxo —, e usa cada um para marcar um
 * bloco diferente: os três cartões de escopo, as três colunas do cronograma, os
 * dois cartões de preço. É o que faz a página ter ritmo em vez de uma lista de
 * caixas iguais.
 *
 * Então o tema passa a guardar uma **paleta curta**, e o render distribui os
 * acentos por posição. Quem define um acento só continua tendo o comportamento
 * de antes, porque a distribuição cicla.
 *
 * ## Módulo neutro, de propósito
 *
 * Sem `server-only` e sem Prisma: a tela do modelo precisa do mesmo tipo e do
 * mesmo leitor para desenhar o seletor de identidade, e `check-marca` varre o
 * bundle do cliente. Ver [[server-only-no-bundle-do-cliente]] — o valor que a
 * tela precisa nasce em módulo neutro.
 */

/** `#rrggbb`. Qualquer outra coisa é ignorada, para nada gravado virar CSS. */
const COR_HEX = /^#[0-9a-fA-F]{6}$/

/**
 * As duas famílias que o produto já serve, e **só elas**.
 *
 * Não é lista de fontes do Google: são as duas que `next/font` já baixa e serve
 * do nosso domínio (`--font-open-sans` e `--font-inter`, ver o `layout.tsx` de
 * cada app). Fonte que o navegador tenha de buscar fora não imprime igual em
 * máquina nenhuma, e numa proposta impressa isso é a diferença entre parecer
 * desenhada e parecer um formulário.
 *
 * `padrao` é a do sistema, humanista e boa para texto corrido. `tecnica` é a
 * Inter, geométrica e de numeral tabular — é a que se parece com a referência.
 */
export const FONTES = ['padrao', 'tecnica'] as const
export type FonteDoDocumento = (typeof FONTES)[number]

export const ROTULO_DA_FONTE: Record<FonteDoDocumento, string> = {
    padrao: 'Padrão — humanista, boa para texto longo',
    tecnica: 'Técnica — geométrica, numerais alinhados',
}

/** A capa clara herda o fundo suave do acento; a escura inverte o documento. */
export const ESTILOS_DE_CAPA = ['clara', 'escura'] as const
export type EstiloDaCapa = (typeof ESTILOS_DE_CAPA)[number]

export const ROTULO_DA_CAPA: Record<EstiloDaCapa, string> = {
    clara: 'Clara',
    escura: 'Escura',
}

/** No máximo três: a quarta cor não marca mais nada, só suja. */
export const MAXIMO_DE_ACENTOS = 3

export interface TemaDoModelo {
    /**
     * De um a três `#rrggbb`. O primeiro é o principal.
     *
     * Vazio significa "use o tema do app", que é o comportamento de todo modelo
     * que existia antes desta mudança.
     */
    acentos: string[]
    fonte: FonteDoDocumento
    capa: EstiloDaCapa
    /** Mostrar a logomarca da organização no documento. */
    logo: boolean
}

/**
 * O padrão é o comportamento de antes: sem acento próprio, fonte do sistema,
 * capa clara. **Com a logomarca ligada**, que é a única mudança de padrão — uma
 * proposta sem a marca de quem a envia não é escolha de desenho, é esquecimento,
 * e a organização que não tiver logo cadastrada simplesmente não mostra nada.
 */
export const TEMA_PADRAO: TemaDoModelo = {
    acentos: [],
    fonte: 'padrao',
    capa: 'clara',
    logo: true,
}

/**
 * Lê o tema de JSON. **Nunca lança; o pior caso é o tema do app.**
 *
 * Aceita a forma antiga (`{ cor: '#rrggbb' }`) e a converte num acento só, para
 * que nenhum modelo já gravado perca a identidade na subida. Era a única forma
 * que existia até 27/11/2026.
 */
export function lerTema(valor: unknown): TemaDoModelo {
    /**
     * **Três formas chegam aqui, e as duas antigas são de migração.**
     *
     * A string crua (`'#rrggbb'`) é o que os três pontos de tela ainda passam:
     * eles guardavam a cor solta, não o tema. Aceitá-la aqui é o que permite
     * esta mudança entrar sem reescrever a tela de modelo no mesmo passo — e o
     * que garante que nenhum modelo gravado perca a cor na subida.
     *
     * A forma `{ cor }` é o que está no banco desde a v2.
     * A forma `{ acentos, fonte, capa, logo }` é a desta rodada.
     */
    if (typeof valor === 'string') {
        return COR_HEX.test(valor) ? { ...TEMA_PADRAO, acentos: [valor] } : TEMA_PADRAO
    }

    const raw = (valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {}) as Record<
        string,
        unknown
    >

    /**
     * A forma nova ganha da antiga quando as duas vêm, e a antiga sobrevive
     * sozinha. Gravar as duas não acontece pelo produto, mas o JSON é de dado e
     * dado velho dura mais que código.
     */
    const daLista = Array.isArray(raw.acentos) ? raw.acentos : []
    const daCorAntiga = typeof raw.cor === 'string' ? [raw.cor] : []
    const acentos = (daLista.length > 0 ? daLista : daCorAntiga)
        .filter((c): c is string => typeof c === 'string' && COR_HEX.test(c))
        .slice(0, MAXIMO_DE_ACENTOS)

    return {
        acentos,
        fonte: FONTES.includes(raw.fonte as FonteDoDocumento)
            ? (raw.fonte as FonteDoDocumento)
            : TEMA_PADRAO.fonte,
        capa: ESTILOS_DE_CAPA.includes(raw.capa as EstiloDaCapa)
            ? (raw.capa as EstiloDaCapa)
            : TEMA_PADRAO.capa,
        logo: typeof raw.logo === 'boolean' ? raw.logo : TEMA_PADRAO.logo,
    }
}

/**
 * O tema de volta para JSON, já normalizado.
 *
 * A rota grava o que **sai daqui**, nunca o que chegou do corpo da requisição:
 * é o que impede cor arbitrária, quarto acento e fonte inventada de entrarem no
 * banco e voltarem como CSS. Mesma disciplina de `lerPoliticaDoCanal`.
 */
export function temaParaJson(tema: TemaDoModelo): Record<string, unknown> {
    return { acentos: tema.acentos, fonte: tema.fonte, capa: tema.capa, logo: tema.logo }
}
