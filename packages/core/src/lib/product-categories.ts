import type { Vocabulario } from './vocabulario'
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
 * O vocabulário entra por PARÂMETRO, e é obrigatório.
 *
 * Este módulo é alcançado pelo bundle do CLIENTE, e no navegador ninguém
 * registrou a marca: ler `vocab()` por dentro lançava
 * `MarcaNaoRegistradaError` na hidratação — depois de compilar, buildar e
 * publicar sem uma reclamação. Medido em 15/11/2026, e era defeito em
 * produção. No cliente as palavras vêm de `useVocab()`; no servidor, de
 * `vocab(settings)`. Na assinatura, a cobrança é do compilador.
 *
 * A memoização de módulo saiu junto: o resultado depende do argumento, e um
 * cache global devolveria a palavra da primeira unidade a todas as outras.
 */
export function PRODUCT_CATEGORIES(v: Vocabulario) {
    return [
        { id: 'service', label: 'Serviço' },
        { id: 'procedure', label: v.Servico },
        { id: 'product', label: 'Produto' },
    ] as const
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
export function categoryLabel(category: string | null | undefined, v: Vocabulario): string {
    return PRODUCT_CATEGORIES(v).find((c) => c.id === category)?.label ?? 'Item'
}
