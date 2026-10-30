import prisma from '@/lib/prisma'
import { getBillingState, spendCredits } from '@/lib/billing'
import { LLMProviderName } from '@/types/llm'
/**
 * `Decimal` sai do cliente gerado, não de `@prisma/client/runtime/library`.
 *
 * Com o gerador novo, o runtime depende do destino (Node ou workerd), e apontar
 * para um caminho fixo dentro de `@prisma/client` amarraria este arquivo a um
 * dos dois. `Prisma.Decimal` é reexportado pelos dois clientes.
 */
import { Prisma } from '#prisma'
import { findModel, findTtsModel } from './models'


export interface UsageData {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    /**
     * Tokens do prompt que o provedor cobrou com desconto de cache.
     *
     * Entra no `metadata` do registro, e não em coluna: é instrumentação da
     * nossa margem, não da carteira do cliente. É também a **única** prova de
     * que a ordenação estável→volátil do prompt está valendo — sem registrar,
     * o prefixo pode voltar a ser quebrado sem ninguém notar.
     */
    cachedTokens?: number
}

export interface TrackingContext {
    workspaceId: string
    agentId?: string
    metadata?: Record<string, unknown>
}

/**
 * Calculate the cost of a generation based on tokens used
 */
export function calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
): number {
    const info = findModel(model)

    if (!info) {
        // Barato demais de propósito seria pior que ruidoso: o crédito do
        // cliente é debitado por este número, então um modelo sem preço
        // precisa aparecer no log em vez de ser cobrado por um palpite.
        console.error(
            `[LLM_USAGE] modelo "${model}" não está em OPENAI_MODELS — ` +
                'cobrando pelo fallback. Acrescente-o ao catálogo com o preço real.'
        )
    }

    const pricing = info?.price ?? { input: 0.5, output: 1.5 }

    // Cost = (tokens / 1M) * price per 1M
    const inputCost = (promptTokens / 1_000_000) * pricing.input
    const outputCost = (completionTokens / 1_000_000) * pricing.output

    return inputCost + outputCost
}

/**
 * Check if workspace has enough credits for a request
 */
export async function checkCredits(workspaceId: string): Promise<{
    hasCredits: boolean
    credits: number
    creditsUsed: number
}> {
    // Delegado ao motor de cobrança, que é quem sabe o que é uma avaliação.
    //
    // A versão anterior exigia `status === 'active'`: um workspace em `trialing`
    // — com 1.000 créditos intactos — era tratado como sem crédito, o agente
    // ficava mudo durante os 7 dias de teste, e o paciente recebia "vamos
    // continuar em instantes". O primeiro cadastro real caiu exatamente nisso.
    // `getBillingState` já responde à pergunta certa: a fase permite responder
    // (trial ou plano ativo, não somente-leitura) e sobra crédito em algum
    // balde — do plano ou avulso.
    const state = await getBillingState(workspaceId)
    const available = state.credits.plan.remaining + state.credits.purchased.remaining

    return {
        hasCredits: !state.readOnly && available > 0,
        credits: state.credits.plan.total,
        creditsUsed: state.credits.plan.used,
    }
}

/**
 * Track usage and update credits
 */
export async function trackUsage(
    provider: LLMProviderName,
    model: string,
    usage: UsageData,
    context: TrackingContext
): Promise<void> {
    const costUsd = calculateCost(model, usage.promptTokens, usage.completionTokens)

    // Create usage log
    await prisma.usageLog.create({
        data: {
            workspaceId: context.workspaceId,
            agentId: context.agentId,
            provider,
            model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            costUsd: new Prisma.Decimal(costUsd),
            metadata: {
                ...(context.metadata ?? {}),
                // Zero é informação: diz que o prefixo **não** foi aproveitado.
                // Ausente, não dá para distinguir "sem cache" de "não medido".
                cachedTokens: usage.cachedTokens ?? 0,
            } as Prisma.InputJsonValue,
        }
    })

    // **Não debita crédito.** Esta função mede o nosso custo em dólar; quem
    // debita a carteira do cliente é `spendAiCredits`, uma vez por ação de IA
    // entregue. Ver o comentário dela para o porquê.
    console.log(`[USAGE_TRACKER] Logged: ${usage.totalTokens} tokens, $${costUsd.toFixed(6)} USD`)
}

/**
 * Debita a carteira do cliente: **uma ação de IA, um crédito**.
 *
 * Antes o débito saía de `trackUsage`, que roda a cada ida ao modelo, com
 * `Math.ceil(custo * 100)`. Duas consequências medidas em produção:
 *
 * 1. **A ferramenta era punida.** Uma resposta que consulta a agenda e marca a
 *    consulta usa de 4 a 6 chamadas (medido), então custava 4 a 6 créditos,
 *    contra 1 de uma resposta simples. Mesmo valor para a clínica, seis vezes o
 *    preço — cobrávamos mais caro justamente a função que fecha a venda.
 * 2. **O arredondamento era o preço.** Uma chamada custa $0,00014 em média
 *    (26 medições em `gpt-4o-mini`); o `ceil` cobrava $0,01. O crédito "valia"
 *    73x o que consumia, e a conta do cliente não tinha relação com a nossa.
 *
 * Agora o crédito é unidade de **valor entregue**, não de custo de chamada:
 * uma resposta do agente, uma sugestão de follow-up, um resumo de conversa.
 * "10.000 créditos = 10.000 respostas do seu agente" é uma frase que dona de
 * clínica entende; "10.000 créditos = número variável de chamadas a um modelo"
 * não é.
 *
 * O nosso custo real não se perde: continua em `usage_logs`, em dólar, por
 * chamada — que é onde margem se olha, não na carteira do cliente.
 *
 * **Áudio conta 1, como tudo o mais — e o que o segura é o teto.**
 *
 * Este comentário já dizia "áudio conta 2", e o código nunca cobrou 2: a
 * chamada em `ai-reply` sempre passou 1, mudando só o rótulo do log. Corrigido
 * em 2026-10-20, a favor do código — a decisão que valeu está escrita no ponto
 * do débito: com crédito abstrato, peso variável deixa a carteira
 * imprevisível para quem olha a tela, e quem limita a fala é
 * `maxSpokenReplies` (400 / 750 / 1.500 por plano).
 *
 * O risco que o peso cobriria continua real e vale medir de novo se a conta
 * mudar: uma resposta falada custa a nós cerca de **34x** uma escrita
 * (R$ 0,024 contra R$ 0,0007 nas medições de 2026-10-15; o custo da fala foi
 * revisto para cima em 2026-10-20, ver `TTS_MODELS`). É o teto que impede que
 * uma clínica com áudio em tudo coma a margem — não o preço do crédito.
 */
export async function spendAiCredits(
    workspaceId: string,
    units: number,
    /** Só para o log, quando é preciso saber qual ação gastou. */
    label: string
): Promise<void> {
    if (units <= 0) return

    /**
     * O débito passa pelos dois baldes, plano e avulso.
     *
     * Aqui havia um `subscription.updateMany` que só incrementava
     * `creditsUsed` — o balde do plano. Mas `checkCredits` libera a resposta
     * olhando `plano + avulso`, e `CreditPurchase.used` não era incrementado por
     * ninguém. O efeito era um workspace com um lote avulso vivo responder para
     * sempre depois de estourar o plano, porque o saldo avulso nunca descia.
     *
     * `spendCredits` gasta o plano primeiro (que é descartado na renovação de
     * todo modo) e depois os lotes avulsos, do que expira mais cedo para o mais
     * tarde.
     */
    const { spent, shortfall } = await spendCredits(workspaceId, units)

    if (shortfall > 0) {
        // A ação já foi entregue: cobrar o que não havia é impossível, e
        // esconder isso deixaria o prejuízo invisível. A próxima é barrada pelo
        // `checkCredits`, que vê saldo zero.
        console.warn(
            `[AI_CREDITS] workspace ${workspaceId} consumiu ${units} crédito(s) ` +
                `em "${label}" e só tinha ${spent}: ${shortfall} além do saldo.`
        )
        return
    }

    console.log(`[AI_CREDITS] ${workspaceId}: ${units} crédito(s) em "${label}"`)
}

/**
 * Contabiliza a fala do agente e debita o crédito dela.
 *
 * Caminho separado do `trackUsage` porque a unidade é outra: a rota de fala não
 * devolve relatório de uso, então o custo sai do **tamanho do texto** e da
 * tabela de `TTS_MODELS`. Ver o comentário de lá sobre isso ser estimativa.
 *
 * Os três campos de token vão a **zero**, de propósito: somar caractere na
 * coluna de token faria o relatório de tokens mentir para sempre, e quem olha
 * consumo por modelo veria a fala inflando o número do GPT. A linha fica com
 * custo real, token zero, e `metadata.characters` guardando o que foi medido.
 */
export async function trackSpeechUsage(
    model: string,
    characters: number,
    context: TrackingContext
): Promise<void> {
    const info = findTtsModel(model)

    if (!info) {
        // Mesma regra do `calculateCost`: modelo sem preço aparece no log em vez
        // de ser cobrado por palpite silencioso.
        console.error(
            `[TTS_USAGE] modelo "${model}" não está em TTS_MODELS — ` +
                'cobrando pelo fallback. Acrescente-o ao catálogo com o preço real.'
        )
    }

    const usdPerMillion = info?.usdPerMillionChars ?? 15.0
    const costUsd = (characters / 1_000_000) * usdPerMillion

    await prisma.usageLog.create({
        data: {
            workspaceId: context.workspaceId,
            agentId: context.agentId,
            provider: 'openai',
            model,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: new Prisma.Decimal(costUsd),
            metadata: {
                ...(context.metadata ?? {}),
                kind: 'tts',
                characters,
            } as Prisma.InputJsonValue,
        },
    })

    // Também não debita: a fala é parte de **uma** resposta, e é a resposta que
    // custa crédito (2 quando falada). Ver `spendAiCredits`.
    console.log(`[TTS_USAGE] ${characters} caractere(s) em ${model}, $${costUsd.toFixed(6)} USD`)
}

/**
 * Get usage summary for a workspace
 */
export async function getUsageSummary(workspaceId: string, days: number = 30): Promise<{
    totalTokens: number
    totalCost: number
    byModel: Record<string, { tokens: number; cost: number }>
}> {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const logs = await prisma.usageLog.findMany({
        where: {
            workspaceId,
            createdAt: { gte: startDate }
        },
        select: {
            model: true,
            totalTokens: true,
            costUsd: true,
        }
    })

    const byModel: Record<string, { tokens: number; cost: number }> = {}
    let totalTokens = 0
    let totalCost = 0

    for (const log of logs) {
        totalTokens += log.totalTokens
        totalCost += Number(log.costUsd)

        if (!byModel[log.model]) {
            byModel[log.model] = { tokens: 0, cost: 0 }
        }
        byModel[log.model].tokens += log.totalTokens
        byModel[log.model].cost += Number(log.costUsd)
    }

    return { totalTokens, totalCost, byModel }
}
