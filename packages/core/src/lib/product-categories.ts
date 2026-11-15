import { vocab } from './vocabulario'
/**
 * As três categorias de item da clínica, e quais delas ocupam a agenda.
 *
 * `procedure` sempre existiu no banco e **nunca apareceu na tela**: o seletor
 * oferecia Produto e Serviço, então ninguém conseguia cadastrar o que a agenda
 * e o agente de IA procuram. Era um conceito inteiro invisível.
 *
 * A ordem é a de uso numa clínica: o que ela vende o dia todo primeiro, a
 * mercadoria por último.
 */
/**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada —, e a publicação reprova com
 * `MarcaNaoRegistradaError`. A forma que já reprovou cinco publicações.
 */
function montarProductCategories() {
    return [
    { id: 'service', label: 'Serviço' },
    { id: 'procedure', label: `${vocab().Servico}` },
    { id: 'product', label: 'Produto' },
] as const
}
let productCategoriesCache: ReturnType<typeof montarProductCategories> | null = null
export function PRODUCT_CATEGORIES(): ReturnType<typeof montarProductCategories> {
    if (productCategoriesCache === null) productCategoriesCache = montarProductCategories()
    return productCategoriesCache
}

export type ProductCategory = ReturnType<typeof PRODUCT_CATEGORIES>[number]['id']

/**
 * O que ocupa tempo na agenda — e, por isso, tem duração.
 *
 * **Serviço entra junto com servico.** Antes só `procedure` carregava
 * `durationMinutes`, e as duas rotas zeravam a duração de serviço mesmo que
 * alguém a mandasse. Só que limpeza e clareamento ocupam cadeira igual a um
 * implante: a distinção entre serviço e servico é de catálogo, não de
 * agenda.
 *
 * Esta lista é a fonte de "é agendável" em todo lugar — o seletor da agenda, as
 * janelas do profissional, a consulta de disponibilidade e as ferramentas do
 * agente. Sete lugares comparavam com `'procedure'` escrito à mão; com um item
 * fora desta lista, o campo de duração existiria na tela e a agenda o ignoraria
 * em silêncio.
 */
export const SCHEDULABLE_CATEGORIES: ProductCategory[] = ['service', 'procedure']

/** Se esta categoria ocupa tempo na agenda. */
export function isSchedulable(category: string | null | undefined): boolean {
    return (SCHEDULABLE_CATEGORIES as string[]).includes(category ?? '')
}

/** O rótulo da categoria, para a tela. */
export function categoryLabel(category: string | null | undefined): string {
    return PRODUCT_CATEGORIES().find((c) => c.id === category)?.label ?? 'Item'
}
