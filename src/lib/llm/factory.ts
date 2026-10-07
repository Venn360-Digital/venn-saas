import { LLMConfig, LLMProvider, LLMProviderName } from '@/types/llm'
import { OpenAIProvider } from './openai'
import { DEFAULT_MODEL } from './models'

export class LLMFactory {
    /**
     * Creates an instance of an LLM Provider based on the name.
     * Credentials should ideally be loaded from environment or passed securely.
     */
    static create(provider: LLMProviderName, config?: Partial<LLMConfig>): LLMProvider {
        const apiKey = LLMFactory.getApiKey(provider, config?.apiKey)
        const model = config?.model || DEFAULT_MODEL

        const fullConfig: LLMConfig = {
            apiKey,
            model,
            temperature: config?.temperature ?? 0.7,
            maxTokens: config?.maxTokens,
        }

        switch (provider) {
            case 'openai':
                return new OpenAIProvider(fullConfig)
            default:
                throw new Error(`Unsupported LLM provider: ${provider}`)
        }
    }

    private static getApiKey(provider: LLMProviderName, overrideKey?: string): string {
        if (overrideKey) return overrideKey

        const envKey = process.env.OPENAI_API_KEY

        if (!envKey) {
            throw new Error(`Missing API Key for provider: ${provider}`)
        }
        return envKey
    }
}
