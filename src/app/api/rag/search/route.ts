import { NextRequest, NextResponse } from 'next/server'
import { readAgent } from '@/lib/auth/agent'
import { DocumentRetriever } from '@/lib/rag/retriever'
import { z } from 'zod'

const searchSchema = z.object({
    agentId: z.string(),
    query: z.string(),
    limit: z.number().optional().default(5),
})

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const validatedData = searchSchema.parse(body)

        /**
         * `readAgent` em vez de resolver participação à mão.
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
        const auth = await readAgent(validatedData.agentId)
        if (!auth.ok) return auth.response

        // Perform search
        const retriever = new DocumentRetriever()
        const results = await retriever.search(
            validatedData.agentId,
            validatedData.query,
            validatedData.limit
        )

        return NextResponse.json({ results })
    } catch (error) {
        console.error('[RAG_SEARCH]', error)
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify(error.issues), { status: 400 })
        }
        return new NextResponse('Internal Error', { status: 500 })
    }
}
