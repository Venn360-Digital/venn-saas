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

export interface LLMMessage {
    role: LLMRole
    content: string
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
    /** Presente quando o modelo pediu ferramentas em vez de responder. */
    toolCalls?: LLMToolCall[]
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
