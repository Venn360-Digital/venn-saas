import Anthropic from '@anthropic-ai/sdk'
import { LLMConfig, LLMMessage, LLMProvider, LLMResponse, LLMUsage } from '@/types/llm'

export class ClaudeProvider implements LLMProvider {
    private client: Anthropic
    private config: LLMConfig

    constructor(config: LLMConfig) {
        this.config = config
        this.client = new Anthropic({
            apiKey: config.apiKey,
        })
    }

    async generate(messages: LLMMessage[]): Promise<LLMResponse> {
        const systemMessage = messages.find(m => m.role === 'system')
        const conversationMessages = messages.filter(m => m.role !== 'system')

        const response = await this.client.messages.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens ?? 4096,
            temperature: this.config.temperature ?? 0.7,
            system: systemMessage?.content,
            messages: conversationMessages.map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content,
            })),
        })

        // Claude returns input/output tokens in usage
        const usage: LLMUsage = {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        }

        const textContent = response.content.find((block: any) => block.type === 'text')

        return {
            content: textContent?.type === 'text' ? textContent.text : '',
            usage,
        }
    }

    async *generateStream(messages: LLMMessage[]): AsyncGenerator<string, LLMUsage, unknown> {
        const systemMessage = messages.find(m => m.role === 'system')
        const conversationMessages = messages.filter(m => m.role !== 'system')

        const stream = await this.client.messages.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens ?? 4096,
            temperature: this.config.temperature ?? 0.7,
            system: systemMessage?.content,
            messages: conversationMessages.map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content,
            })),
            stream: true,
        })

        let usage: LLMUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
        }

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                yield event.delta.text
            }

            // Capture usage from message_delta event
            if (event.type === 'message_delta' && event.usage) {
                usage = {
                    promptTokens: usage.promptTokens, // Keep previous
                    completionTokens: event.usage.output_tokens,
                    totalTokens: usage.promptTokens + event.usage.output_tokens,
                }
            }

            // Capture input tokens from message_start
            if (event.type === 'message_start' && event.message.usage) {
                usage.promptTokens = event.message.usage.input_tokens
            }
        }

        return usage
    }
}
