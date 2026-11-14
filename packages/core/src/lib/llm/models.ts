/**
 * O catálogo de modelos — fonte única.
 *
 * Existe porque duas listas separadas já se desencontraram em produção: o
 * seletor da tela de agentes oferecia seis modelos, cinco dos quais a chave da
 * conta não tinha permissão para usar, e a tabela de preços do `usage-tracker`
 * listava modelos que o seletor não oferecia e omitia outros que oferecia.
 *
 * O acoplamento importa porque é daqui que sai o **nosso custo em dólar** em
 * `usage_logs` — onde se olha margem e se precifica o crédito. (Este comentário
 * já disse que o crédito do cliente saía deste preço; **não sai**, e a confusão
 * custou caro em 2026-10-28: quem debita é `spendAiCredits`, 1 ação entregue =
 * 1 crédito. Ver o comentário dela.) Um modelo na tela sem preço aqui cai no
 * fallback — e fallback barato em modelo caro é prejuízo silencioso.
 *
 * `price` é em dólares por 1 milhão de tokens, na modalidade **Standard** — que
 * é a que usamos, porque o código não pede `service_tier`. Cuidado ao conferir
 * na tabela da OpenAI: a aba **Flex/Batch** mostra metade do valor, e foi
 * exatamente essa diferença que fez o custo do AI Gateway divergir 2× do nosso
 * (ele calcula pela modalidade barata). Copie da aba **Standard**.
 *
 * Para acrescentar um modelo: confira o preço na aba Standard **e** confira que
 * ele está na allowlist do projeto no painel da OpenAI — o tipo obriga o
 * primeiro, e só o teste real pega o segundo (403 `model_not_found`). A
 * allowlist é **por projeto**: cada produto tem a sua chave, então liberar num
 * não libera nos outros.
 */

export interface ModelInfo {
    id: string
    label: string
    /** Dólares por 1M de tokens. */
    price: { input: number; output: number }
}

export const OPENAI_MODELS: ModelInfo[] = [
    {
        id: 'gpt-6.1-sol',
        label: 'GPT-6.1 Sol — mais capaz',
        price: { input: 2.0, output: 10.0 },
    },
    {
        id: 'gpt-6.1-terra',
        label: 'GPT-6.1 Terra — equilíbrio',
        price: { input: 1.0, output: 5.0 },
    },
    {
        id: 'gpt-6-luna',
        label: 'GPT-6 Luna — econômico',
        price: { input: 0.1, output: 0.5 },
    },
    /**
     * Os `gpt-4o` continuam listados porque **agentes existentes apontam para
     * eles** (`Agent.llmModel`), e sumir com a opção quebraria a tela de quem já
     * escolheu. São geração anterior e, no catálogo atual, custam mais que o
     * Terra fazendo menos — a migração é por agente, depois de comparar.
     */
    {
        id: 'gpt-4o',
        label: 'GPT-4o — geração anterior',
        price: { input: 2.5, output: 10.0 },
    },
    {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini — geração anterior, econômico',
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
    /**
     * **18, e não 3.** O 3 vinha de uma leitura errada da tabela da OpenAI.
     *
     * Eles cobram este modelo por **token de áudio** — US$ 12 por 1M de tokens
     * de saída, ou ~US$ 0,015 por minuto falado —, e nenhum dos dois é
     * caractere. A conversão é pela cadência: português corrido sai a cerca de
     * 825 caracteres por minuto, então 1M de caracteres são ~1.212 minutos e
     * ~US$ 18. Conferido contra a página de preços em 2026-10-20.
     *
     * O erro ficava invisível porque **este número não cobra ninguém**: o
     * cliente paga 1 crédito por resposta entregue, falada ou escrita, e o
     * dólar daqui só alimenta `usage_logs.costUsd`. Ele existe para a margem
     * ser legível na hora de dimensionar plano — e, subestimado em seis vezes,
     * era exatamente ali que mentia.
     */
    { id: 'gpt-4o-mini-tts', usdPerMillionChars: 18.0, acceptsInstructions: true },
    /** Este a OpenAI cobra por caractere mesmo: US$ 15/1M, exato. */
    { id: 'tts-1', usdPerMillionChars: 15.0, acceptsInstructions: false },
]

export function findTtsModel(id: string): TtsModelInfo | undefined {
    return TTS_MODELS.find((model) => model.id === id)
}
