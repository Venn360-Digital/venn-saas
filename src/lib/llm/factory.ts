import { LLMConfig, LLMProvider, LLMProviderName } from '@/types/llm'
import { OpenAIProvider } from './openai'
import { GeminiProvider } from './gemini'
import { ClaudeProvider } from './claude'

export class LLMFactory {
    /**
     * Creates an instance of an LLM Provider based on the name.
     * Credentials should ideally be loaded from environment or passed securely.
     */
    static create(provider: LLMProviderName, config?: Partial<LLMConfig>): LLMProvider {
        const apiKey = LLMFactory.getApiKey(provider, config?.apiKey)
        const model = config?.model || LLMFactory.getDefaultModel(provider)

        const fullConfig: LLMConfig = {
            apiKey,
            model,
            temperature: config?.temperature ?? 0.7,
            maxTokens: config?.maxTokens,
        }

        switch (provider) {
            case 'openai':
                return new OpenAIProvider(fullConfig)
            case 'gemini':
                return new GeminiProvider(fullConfig)
            case 'claude':
                return new ClaudeProvider(fullConfig)
            default:
                throw new Error(`Unsupported LLM provider: ${provider}`)
        }
    }

    private static getApiKey(provider: LLMProviderName, overrideKey?: string): string {
        if (overrideKey) return overrideKey

        let envKey: string | undefined

        switch (provider) {
            case 'openai':
                envKey = process.env.OPENAI_API_KEY
                break
            case 'gemini':
                envKey = process.env.GOOGLE_AI_API_KEY
                break
            case 'claude':
                envKey = process.env.ANTHROPIC_API_KEY
                break
        }

        if (!envKey) {
            throw new Error(`Missing API Key for provider: ${provider}`)
        }
        return envKey
    }

    private static getDefaultModel(provider: LLMProviderName): string {
        switch (provider) {
            case 'openai':
                return 'gpt-4o'
            case 'gemini':
                return 'gemini-1.5-pro-latest'
            case 'claude':
                return 'claude-3-5-sonnet-20241022'
            default:
                return ''
        }
    }
}
