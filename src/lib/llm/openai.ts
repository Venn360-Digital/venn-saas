import OpenAI from 'openai'
import { LLMConfig, LLMMessage, LLMProvider, LLMResponse, LLMUsage } from '@/types/llm'

export class OpenAIProvider implements LLMProvider {
    private client: OpenAI
    private config: LLMConfig

    constructor(config: LLMConfig) {
        this.config = config
        this.client = new OpenAI({
            apiKey: config.apiKey,
        })
    }

    async generate(messages: LLMMessage[]): Promise<LLMResponse> {
        const response = await this.client.chat.completions.create({
            model: this.config.model,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            temperature: this.config.temperature ?? 0.7,
            max_tokens: this.config.maxTokens,
        })

        const usage: LLMUsage = {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
            totalTokens: response.usage?.total_tokens ?? 0,
        }

        return {
            content: response.choices[0]?.message?.content ?? '',
            usage,
        }
    }

    async *generateStream(messages: LLMMessage[]): AsyncGenerator<string, LLMUsage, unknown> {
        const stream = await this.client.chat.completions.create({
            model: this.config.model,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            temperature: this.config.temperature ?? 0.7,
            max_tokens: this.config.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
        })

        let usage: LLMUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
        }

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
                yield content
            }

            // Capture usage from the final chunk
            if (chunk.usage) {
                usage = {
                    promptTokens: chunk.usage.prompt_tokens ?? 0,
                    completionTokens: chunk.usage.completion_tokens ?? 0,
                    totalTokens: chunk.usage.total_tokens ?? 0,
                }
            }
        }

        return usage
    }
}
