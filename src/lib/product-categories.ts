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
export const PRODUCT_CATEGORIES = [
    { id: 'service', label: 'Serviço' },
    { id: 'procedure', label: 'Procedimento' },
    { id: 'product', label: 'Produto' },
] as const

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]['id']

/**
 * O que ocupa tempo na agenda — e, por isso, tem duração.
 *
 * **Serviço entra junto com procedimento.** Antes só `procedure` carregava
 * `durationMinutes`, e as duas rotas zeravam a duração de serviço mesmo que
 * alguém a mandasse. Só que limpeza e clareamento ocupam cadeira igual a um
 * implante: a distinção entre serviço e procedimento é de catálogo, não de
 * agenda.
 *
 * Esta lista é a fonte de "é agendável" em todo lugar — o seletor da agenda, as
 * janelas do especialista, a consulta de disponibilidade e as ferramentas do
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
    return PRODUCT_CATEGORIES.find((c) => c.id === category)?.label ?? 'Item'
}
