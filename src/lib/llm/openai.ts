import OpenAI from 'openai'
import { textoDoConteudo } from '@/lib/llm/conteudo'
import {
    LLMConfig,
    LLMMessage,
    LLMProvider,
    LLMResponse,
    LLMTool,
    LLMUsage,
} from '@/types/llm'
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
                content: textoDoConteudo(m.content),
                tool_call_id: m.toolCallId ?? '',
            }
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
            return {
                role: 'assistant',
                content: textoDoConteudo(m.content) || null,
                tool_calls: m.toolCalls.map((c) => ({
                    id: c.id,
                    type: 'function' as const,
                    function: { name: c.name, arguments: c.arguments },
                })),
            }
        }

        /**
         * A mensagem multimodal: texto primeiro, imagens depois.
         *
         * A ordem importa para o modelo — a instrução antes do anexo é lida como
         * "faça isto com o que vem a seguir", e o inverso deixa a imagem sem
         * propósito até o fim da leitura.
         *
         * `detail: 'high'` porque o caso que motivou isto é **lista de preços
         * fotografada**: em `low` a API reduz a imagem a 512px e o número vira
         * borrão. Resolução é o que se está pagando aqui.
         */
        if (m.role === 'user' && typeof m.content !== 'string' && m.content.imagens.length > 0) {
            return {
                role: 'user',
                content: [
                    { type: 'text' as const, text: m.content.texto },
                    ...m.content.imagens.map((i) => ({
                        type: 'image_url' as const,
                        image_url: { url: i.dataUrl, detail: 'high' as const },
                    })),
                ],
            }
        }

        return {
            role: m.role,
            content: textoDoConteudo(m.content),
        } as OpenAI.Chat.ChatCompletionMessageParam
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
            /**
             * `max_completion_tokens`, e não `max_tokens`.
             *
             * O segundo está depreciado e **é incompatível com os modelos de
             * raciocínio** — mandá-lo faria a API recusar a chamada justamente
             * nos modelos mais novos do catálogo, e o sintoma seria o agente
             * mudo. Os dois campos querem a mesma coisa; só um atravessa as duas
             * gerações.
             */
            max_completion_tokens: this.config.maxTokens,
            ...(this.config.promptCacheKey
                ? { prompt_cache_key: this.config.promptCacheKey }
                : {}),
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
            // Quanto do prompt o provedor cobrou com desconto. É o que torna o
            // prefixo cacheável verificável em vez de acreditado.
            cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        }

        const escolha = response.choices[0]
        const message = escolha?.message
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
            ...(escolha?.finish_reason ? { finishReason: escolha.finish_reason } : {}),
        }
    }

    async *generateStream(messages: LLMMessage[]): AsyncGenerator<string, LLMUsage, unknown> {
        const stream = await this.client.chat.completions.create({
            model: this.config.model,
            messages: toApiMessages(messages),
            temperature: this.config.temperature ?? 0.7,
            // Mesmo campo da chamada normal; ver o comentário em `generate`.
            max_completion_tokens: this.config.maxTokens,
            ...(this.config.promptCacheKey
                ? { prompt_cache_key: this.config.promptCacheKey }
                : {}),
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
                    cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
                }
            }
        }

        return usage
    }
}
