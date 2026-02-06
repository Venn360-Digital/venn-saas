export type LLMProviderName = 'openai' | 'gemini' | 'claude'
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

// Configuration defaults
export const DEFAULT_MODELS = {
    openai: 'gpt-4o',
    gemini: 'gemini-1.5-pro-latest',
    claude: 'claude-3-5-sonnet-20241022',
} as const
