/**
 * O catálogo de modelos — fonte única.
 *
 * Existe porque duas listas separadas já se desencontraram em produção: o
 * seletor da tela de agentes oferecia seis modelos, cinco dos quais a chave da
 * conta não tinha permissão para usar, e a tabela de preços do `usage-tracker`
 * listava modelos que o seletor não oferecia e omitia outros que oferecia.
 *
 * O acoplamento importa porque os créditos do cliente são debitados pelo custo
 * real da chamada (PRODUCT.md §2). Um modelo renderizado na tela sem preço aqui
 * seria cobrado pelo fallback — e um fallback barato num modelo caro é prejuízo
 * silencioso, do tipo que só aparece na fatura do mês seguinte.
 *
 * `price` é em dólares por 1 milhão de tokens. Para acrescentar um modelo:
 * confira o preço na tabela oficial da OpenAI e confira que ele está na allowlist
 * do projeto no painel — o tipo obriga o primeiro, e só o teste real pega o
 * segundo.
 */

export interface ModelInfo {
    id: string
    label: string
    /** Dólares por 1M de tokens. */
    price: { input: number; output: number }
}

export const OPENAI_MODELS: ModelInfo[] = [
    {
        id: 'gpt-4o',
        label: 'GPT-4o — mais capaz',
        price: { input: 2.5, output: 10.0 },
    },
    {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini — mais barato',
        price: { input: 0.15, output: 0.6 },
    },
]

/** O que um agente novo recebe. É também o que o agente existente já usa. */
export const DEFAULT_MODEL = 'gpt-4o'

export function findModel(id: string): ModelInfo | undefined {
    return OPENAI_MODELS.find((model) => model.id === id)
}
