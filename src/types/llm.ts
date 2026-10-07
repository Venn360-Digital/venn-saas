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
export type LLMRole = 'system' | 'user' | 'assistant'

export interface LLMMessage {
    role: LLMRole
    content: string
}

export interface LLMConfig {
    apiKey: string
    model: string
    temperature?: number
    maxTokens?: number
}

export interface LLMUsage {
    promptTokens: number
    completionTokens: number
    totalTokens: number
}

export interface LLMResponse {
    content: string
    usage: LLMUsage
}

export interface LLMProvider {
    /**
     * Generates a single response from the LLM with usage tracking
     */
    generate(messages: LLMMessage[]): Promise<LLMResponse>

    /**
     * Generates a streaming response from the LLM
     * Note: Usage data is returned at the end of streaming
     */
    generateStream(messages: LLMMessage[]): AsyncGenerator<string, LLMUsage, unknown>
}
