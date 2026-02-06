import { GoogleGenerativeAI } from '@google/generative-ai'
import { LLMConfig, LLMMessage, LLMProvider, LLMResponse, LLMUsage } from '@/types/llm'

export class GeminiProvider implements LLMProvider {
    private client: GoogleGenerativeAI
    private config: LLMConfig

    constructor(config: LLMConfig) {
        this.config = config
        this.client = new GoogleGenerativeAI(config.apiKey)
    }

    async generate(messages: LLMMessage[]): Promise<LLMResponse> {
        const model = this.client.getGenerativeModel({
            model: this.config.model,
        })

        const systemMessage = messages.find(m => m.role === 'system')
        const chatHistory = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            }))

        const chat = model.startChat({
            history: chatHistory.slice(0, -1),
            systemInstruction: systemMessage?.content
        })

        const lastMessage = messages[messages.length - 1]
        const result = await chat.sendMessage(lastMessage.content)
        const response = await result.response

        // Gemini returns usage metadata
        const usageMetadata = response.usageMetadata

        const usage: LLMUsage = {
            promptTokens: usageMetadata?.promptTokenCount ?? 0,
            completionTokens: usageMetadata?.candidatesTokenCount ?? 0,
            totalTokens: usageMetadata?.totalTokenCount ?? 0,
        }

        return {
            content: response.text(),
            usage,
        }
    }

    async *generateStream(messages: LLMMessage[]): AsyncGenerator<string, LLMUsage, unknown> {
        const model = this.client.getGenerativeModel({ model: this.config.model })

        const systemMessage = messages.find(m => m.role === 'system')
        const chatHistory = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            }))

        const chat = model.startChat({
            history: chatHistory.slice(0, -1),
            systemInstruction: systemMessage?.content
        })

        const lastMessage = messages[messages.length - 1]
        const result = await chat.sendMessageStream(lastMessage.content)

        let usage: LLMUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
        }

        for await (const chunk of result.stream) {
            const chunkText = chunk.text()
            if (chunkText) {
                yield chunkText
            }

            // Capture usage from final response
            if (chunk.usageMetadata) {
                usage = {
                    promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
                    completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
                    totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
                }
            }
        }

        return usage
    }
}
