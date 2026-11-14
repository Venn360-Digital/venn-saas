/**
 * O MVP é OpenAI-only.
 *
 * O tipo do provedor continua existindo, e `LLMProvider` continua sendo uma
 * interface com uma implementação só, porque é a costura por onde um segundo
 * provedor entra depois — e porque o campo `llmProvider` existe no banco. O que
 * saiu foram as integrações Gemini e Anthropic, que ofereciam escolhas na tela
 * sem nenhuma chave configurada por trás: escolher qualquer uma delas lançava
 * `Missing API Key for provider` e deixava o agente mudo.
 */
export type LLMProviderName = 'openai'
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool'

/**
 * Uma imagem anexada à fala da pessoa.
 *
 * `dataUrl` e não endereço nosso, por duas razões que apontam na mesma direção:
 * a mídia de conversa mora em bucket privado, cuja URL assinada vale dez
 * minutos e **não deve existir em repouso** (ver `lib/midia.ts`); e mandar o
 * byte não depende de o provedor do modelo conseguir alcançar o nosso storage.
 */
export interface LLMImagem {
    dataUrl: string
}

/**
 * O conteúdo de uma mensagem: texto, ou texto com imagens.
 *
 * A forma de array existe para a mensagem multimodal e **só** para ela — o resto
 * do sistema continua passando `string`, que é o caso de 99% das mensagens.
 */
export type LLMConteudo = string | { texto: string; imagens: LLMImagem[] }

export interface LLMMessage {
    role: LLMRole
    content: LLMConteudo
    /**
     * As ferramentas que o modelo decidiu chamar nesta vez.
     *
     * Só em mensagens do assistente. Elas precisam voltar para o modelo na
     * rodada seguinte, junto com o resultado de cada uma — é assim que ele sabe
     * o que já pediu e o que recebeu de volta.
     */
    toolCalls?: LLMToolCall[]
    /** Em mensagens `tool`: a qual chamada este resultado responde. */
    toolCallId?: string
}

export interface LLMToolCall {
    id: string
    name: string
    /** Os argumentos como o modelo os escreveu — JSON, e nem sempre válido. */
    arguments: string
}

/**
 * Uma ferramenta que o agente pode chamar.
 *
 * `parameters` é JSON Schema; é o contrato que o modelo lê para saber o que
 * mandar. Descrição ruim aqui é a causa número um de ferramenta chamada na hora
 * errada — ela é lida pelo modelo como documentação, não como enfeite.
 */
export interface LLMTool {
    name: string
    description: string
    parameters: Record<string, unknown>
}

export interface LLMConfig {
    apiKey: string
    model: string
    temperature?: number
    /**
     * Teto de tokens da resposta.
     *
     * Vai na API como `max_completion_tokens`, e **não** como `max_tokens`:
     * aquele está depreciado e é incompatível com os modelos de raciocínio, o
     * que faria a chamada ser recusada justamente nos modelos mais novos do
     * catálogo. Ver `OpenAIProvider`.
     */
    maxTokens?: number
    /**
     * A chave que agrupa chamadas com o mesmo prefixo, para o cache do provedor.
     *
     * O desconto de prefixo só acontece se a chamada cair na mesma máquina que
     * guardou o prefixo, e esta chave é o que aumenta essa probabilidade. Tem de
     * ser estável por **prefixo**, não por conversa: o prefixo é o bloco estável
     * do prompt, que é o mesmo para todas as conversas de um agente.
     */
    promptCacheKey?: string
}

export interface LLMUsage {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    /**
     * Quantos tokens do prompt vieram do cache do provedor.
     *
     * É a única prova de que a ordenação estável→volátil do prompt está
     * funcionando. Sem registrar isto, o cache é invisível: o prompt pode voltar
     * a ser montado fora de ordem e ninguém percebe, porque a resposta continua
     * certa — só mais caro.
     */
    cachedTokens?: number
}

export interface LLMResponse {
    content: string
    usage: LLMUsage
    /** Presente quando o modelo pediu ferramentas em vez de responder. */
    toolCalls?: LLMToolCall[]
    /**
     * Por que o modelo parou de falar.
     *
     * `length` significa que a resposta **foi cortada** pelo teto de tokens — e
     * sem este campo isso é invisível: o paciente recebe uma frase que termina no
     * meio e o sistema registra sucesso.
     */
    finishReason?: string
}

export interface LLMProvider {
    /**
     * Generates a single response from the LLM with usage tracking
     */
    generate(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse>

    /**
     * Generates a streaming response from the LLM
     * Note: Usage data is returned at the end of streaming
     */
    generateStream(messages: LLMMessage[]): AsyncGenerator<string, LLMUsage, unknown>
}
