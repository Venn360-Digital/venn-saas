import { NextRequest, NextResponse } from 'next/server'
import { manageAgent } from '@venn/core/lib/auth/agent'
import { z } from 'zod'
import { QUEUE } from '@venn/core/lib/queue/definitions'
import { entregar } from '@venn/core/lib/queue/entregar'

const indexSchema = z.object({
    agentId: z.string(),
    title: z.string(),
    /**
     * Teto de tamanho. Era `z.string()` seco, e o texto inteiro viaja dentro
     * do payload do job — o mesmo limite que `agents/knowledge/extract` já
     * aplica ao extrair de arquivo (`MAX_CHARS`).
     */
    content: z.string().max(200_000, 'conteúdo acima de 200.000 caracteres'),
    type: z.enum(['faq', 'doc', 'website']),
    url: z.string().optional(),
    /** Drop previously indexed chunks with this title before re-embedding. */
    replaceExisting: z.boolean().optional(),
})

/**
 * Queue a knowledge document for embedding.
 *
 * Returns 202: chunking and embedding run in the worker. Doing it inline meant
 * one OpenAI round trip per chunk inside the request, so a long PDF reliably
 * timed out and left the document half-indexed.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const data = indexSchema.parse(body)

        /**
         * `manageAgent` em vez de resolver participação à mão.
         *
         * Até 2026-10-23 estas duas rotas do RAG eram as **únicas** em
         * `src/app/api` que consultavam `workspaceUser.findFirst` **sem
         * `isActive: true`** — varredura confirmou. Consequência: desativar
         * alguém em Gerenciamento → Usuários não lhe tirava o acesso ao
         * Cérebro do agente. Ler **e escrever** continuavam valendo.
         *
         * Pior que o acesso: não havia recorte de papel, então um ATENDENTE
         * indexava conteúdo arbitrário que o modelo depois lê como "fonte de
         * verdade" (`trabalhos/servicos/prompt.ts:138-148`) — injeção de
         * prompt persistente no agente que fala com pacientes.
         *
         * O comentário em `lib/auth/workspace.ts:28` registra que o helper
         * antigo tinha exatamente este defeito e que ele foi consertado lá.
         * Estas duas rotas ficaram para trás porque não usavam o helper.
         */
        const auth = await manageAgent(data.agentId)
        if (!auth.ok) return auth.response

        // Pela costura, não por `getQueue()`: no Worker não há Redis, e a chamada
        // direta lançava `MissingRedisUrlError` (medido em 2026-10-23). O id do
        // job saiu da resposta porque o Queues não tem um — e nada o lia.
        await entregar(
            QUEUE.RAG_INDEX,
            {
                agentId: data.agentId,
                documentTitle: data.title,
                content: data.content,
                type: data.type,
                url: data.url,
                replaceExisting: data.replaceExisting ?? false,
            },
            { nome: 'index-document' }
        )

        return NextResponse.json(
            { success: true, message: 'Documento enviado para indexação.' },
            { status: 202 }
        )
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify(error.issues), { status: 400 })
        }
        console.error('[RAG_INDEX]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
