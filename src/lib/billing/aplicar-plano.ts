import prisma from '@/lib/prisma'
import { applyPlanLimits } from '@/lib/limits'
import { renewalDate } from '@/lib/billing'
/**
 * Só `plan-limits`, **nunca** `plans`.
 *
 * O worker chama esta função, e `lib/plans` arrasta ícones do Lucide — React num
 * processo que nunca desenha nada. É a mesma razão que separou os dois arquivos
 * (ver o cabeçalho de `plan-limits.ts`), e o compilador do worker reclama na
 * hora: "Module '@/components/shared/BrandIcons' ... '--jsx' is not set".
 */
import { limitesEfetivos, type PlanId } from '@/lib/plan-limits'

/**
 * Põe a conta no plano: a assinatura, a franquia e o ajuste dos limites.
 *
 * Vive aqui porque **dois caminhos chegam ao mesmo lugar** desde que a cobrança
 * existe. A conta vitalícia e a que ainda não começou a ser cobrada ativam direto
 * pela rota; quem paga ativa pelo webhook, no worker, quando o Asaas confirma.
 * Duas cópias desta função divergiriam na primeira correção — e divergir aqui
 * significa um cliente com franquia diferente do que pagou.
 *
 * É idempotente: aplicar o mesmo plano duas vezes dá o mesmo resultado. Importa
 * porque o webhook é at-least-once e `CHECKOUT_PAID` pode chegar duas vezes.
 */

export interface ResultadoDaAtivacao {
    agentsPaused: number
    agentsReleased: number
    numbersPaused: number
    /** O que contar para quem está olhando a tela. */
    notas: string[]
}

export async function aplicarPlano(opcoes: {
    accountId: string
    /** Uma unidade qualquer da conta — o ajuste de limites entra por ela. */
    workspaceId: string
    plan: PlanId
    /** A assinatura recorrente no Asaas, quando houve pagamento. */
    asaasSubscriptionId?: string | null
}): Promise<ResultadoDaAtivacao> {
    const { accountId, workspaceId, plan, asaasSubscriptionId } = opcoes

    /**
     * O plano **mais** os adicionais contratados.
     *
     * Desde 2026-10-19 cada unidade adicional traz 1 agente, 1 número e 10.000
     * créditos. Aplicar só a tabela do plano faria a troca de plano apagar a
     * capacidade que a clínica comprou à parte — e o sintoma seria um agente
     * pausado logo depois de um upgrade pago.
     */
    const adicionais = await prisma.unitAddon.count({ where: { accountId } })
    const limites = limitesEfetivos(plan, adicionais)

    const dados = {
        plan,
        status: 'active',
        maxAgents: limites.maxAgents,
        maxMessages: limites.maxMessages,
        maxWhatsAppNumbers: limites.maxWhatsAppNumbers,
        maxSpokenReplies: limites.maxSpokenReplies,
        /**
         * A franquia passa a ser a do plano novo e o consumo do mês **fica**.
         *
         * `creditsUsed` não é zerado: é o que impede alternar de plano para
         * recarregar. O saldo é `credits - creditsUsed`, com piso em zero.
         */
        credits: limites.credits,
        trialEndsAt: null,
        /** Pagou: sai de somente-leitura, se estava. */
        readOnlySince: null,
        ...(asaasSubscriptionId ? { asaasSubscriptionId } : {}),
    }

    await prisma.subscription.upsert({
        where: { accountId },
        create: {
            accountId,
            ...dados,
            currentPeriodStart: new Date(),
            currentPeriodEnd: renewalDate(),
        },
        /**
         * O período **não** é reiniciado na troca de plano: a renovação continua
         * contada da assinatura, como diz PRODUCT.md §2. Na primeira ativação
         * ele nasce no `create` acima.
         */
        update: dados,
    })

    const ajuste = await applyPlanLimits(workspaceId, {
        maxAgents: limites.maxAgents,
        maxWhatsAppNumbers: limites.maxWhatsAppNumbers,
    })

    const notas: string[] = []
    if (ajuste.agentsPaused > 0) {
        notas.push(
            `${ajuste.agentsPaused} agente${ajuste.agentsPaused === 1 ? ' foi pausado' : 's foram pausados'} por exceder o plano`
        )
    }
    if (ajuste.numbersPaused > 0) {
        notas.push(
            `${ajuste.numbersPaused} número${ajuste.numbersPaused === 1 ? ' de WhatsApp foi desconectado' : 's de WhatsApp foram desconectados'}`
        )
    }
    if (ajuste.agentsReleased > 0) {
        notas.push(
            `${ajuste.agentsReleased} agente${ajuste.agentsReleased === 1 ? ' foi reativado' : 's foram reativados'}`
        )
    }

    console.info(
        `[APLICAR_PLANO] conta ${accountId} no plano ${plan}` +
            (asaasSubscriptionId ? ` (assinatura ${asaasSubscriptionId})` : ' (sem cobrança)')
    )

    return { ...ajuste, notas }
}
