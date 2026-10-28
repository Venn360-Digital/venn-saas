import OpenAI from 'openai'
import { LLMConfig, LLMMessage, LLMProvider, LLMResponse, LLMTool, LLMUsage } from '@/types/llm'
import { OPENAI_BASE_URL } from '@/lib/llm/base-url'

/**
 * Traduz as mensagens para a forma da API de chat da OpenAI.
 *
 * A ida e a volta de uma ferramenta têm formas próprias: o assistente carrega
 * `tool_calls`, e o resultado volta como uma mensagem de papel `tool` amarrada
 * pelo `tool_call_id`. Sem esse par, a rodada seguinte não fecha e a API recusa.
 */
function toApiMessages(messages: LLMMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((m) => {
        if (m.role === 'tool') {
            return {
                role: 'tool',
                content: m.content,
                tool_call_id: m.toolCallId ?? '',
            }
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
            return {
                role: 'assistant',
                content: m.content || null,
                tool_calls: m.toolCalls.map((c) => ({
                    id: c.id,
                    type: 'function' as const,
                    function: { name: c.name, arguments: c.arguments },
                })),
            }
        }
        return { role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam
    })
}

export class OpenAIProvider implements LLMProvider {
    private client: OpenAI
    private config: LLMConfig

    constructor(config: LLMConfig) {
        this.config = config
        this.client = new OpenAI({
            apiKey: config.apiKey,
            // Pelo AI Gateway quando `OPENAI_BASE_URL` existe; direto quando não.
            baseURL: OPENAI_BASE_URL,
        })
    }

    async generate(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
        const response = await this.client.chat.completions.create({
            model: this.config.model,
            messages: toApiMessages(messages),
            temperature: this.config.temperature ?? 0.7,
            max_tokens: this.config.maxTokens,
            ...(tools?.length
                ? {
                      tools: tools.map((t) => ({
                          type: 'function' as const,
                          function: {
                              name: t.name,
                              description: t.description,
                              parameters: t.parameters,
                          },
                      })),
                  }
                : {}),
        })

        const usage: LLMUsage = {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
            totalTokens: response.usage?.total_tokens ?? 0,
        }

        const message = response.choices[0]?.message
        const toolCalls = message?.tool_calls
            ?.filter((c) => c.type === 'function')
            .map((c) => ({
                id: c.id,
                name: c.function.name,
                arguments: c.function.arguments,
            }))

        return {
            content: message?.content ?? '',
            usage,
            ...(toolCalls?.length ? { toolCalls } : {}),
        }
    }

    async *generateStream(messages: LLMMessage[]): AsyncGenerator<string, LLMUsage, unknown> {
        const stream = await this.client.chat.completions.create({
            model: this.config.model,
            messages: toApiMessages(messages),
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
