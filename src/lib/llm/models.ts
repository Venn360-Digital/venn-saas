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

/**
 * Os modelos de fala, e o preço deles por caractere.
 *
 * Por **caractere**, e não por token, por uma razão prática: a rota
 * `/v1/audio/speech` devolve os bytes do áudio e **nenhum relatório de uso** —
 * não há `usage` na resposta, como há na conversa. O único número que o nosso
 * lado mede com exatidão é o tamanho do texto que mandamos falar, então é por
 * ele que o crédito é debitado.
 *
 * Isso faz destes valores uma **estimativa declarada**, não a fatura. O
 * `gpt-4o-mini-tts` é cobrado pela OpenAI em tokens (texto de entrada mais
 * áudio de saída), e aqui ele vira uma média por caractere; o `tts-1` é cobrado
 * por caractere e esse é exato. Confira na fatura e corrija aqui — é um número,
 * num lugar.
 *
 * Ordem importa: é a ordem de tentativa. O primeiro que a allowlist do projeto
 * aceitar é o que fala, e foi medido que um projeto criado só para conversa e
 * embedding responde 403 `model_not_found` no `tts-1`.
 */
export interface TtsModelInfo {
    id: string
    /** Dólares por 1M de caracteres falados. */
    usdPerMillionChars: number
    /** Se aceita o campo `instructions`, que é a entonação. */
    acceptsInstructions: boolean
}

export const TTS_MODELS: TtsModelInfo[] = [
    { id: 'gpt-4o-mini-tts', usdPerMillionChars: 3.0, acceptsInstructions: true },
    { id: 'tts-1', usdPerMillionChars: 15.0, acceptsInstructions: false },
]

export function findTtsModel(id: string): TtsModelInfo | undefined {
    return TTS_MODELS.find((model) => model.id === id)
}
