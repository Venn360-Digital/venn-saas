import prisma from '@venn/db/cliente'
import { adicionaisVivos } from '@/lib/account'
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
import {
    cicloDe,
    limitesEfetivos,
    treinamentoIncluido,
    type BillingCycle,
    type PlanId,
} from '@/lib/plan-limits'
import { proximaCobranca } from '@/lib/billing/troca-de-plano'

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
    /** Se o plano de topo em 12 meses acabou de conceder um treinamento. */
    treinamentoConcedido: boolean
}

export async function aplicarPlano(opcoes: {
    accountId: string
    /** Uma unidade qualquer da conta — o ajuste de limites entra por ela. */
    workspaceId: string
    plan: PlanId
    /**
     * Mensal ou anual. Ausente conserva o que a assinatura já tem.
     *
     * Opcional de propósito: a renovação e os caminhos que só mexem no plano não
     * têm opinião sobre o ciclo, e passar `'monthly'` por omissão rebaixaria,
     * calado, o cliente que pagou doze meses.
     */
    ciclo?: BillingCycle
    /** A assinatura recorrente no Asaas, quando houve pagamento. */
    asaasSubscriptionId?: string | null
    /**
     * Descer de plano **não** mexe nos tetos nem desliga nada.
     *
     * "Todos os recursos do plano superior continuam valendo até a renovação" —
     * decisão do Andre. Então `plan` muda agora, para o registro e para o preço
     * do próximo ciclo, e os tetos pagos ficam onde estão: quem pagou
     * Multiclínica usa Multiclínica até a virada. É o cron de renovação que
     * traz os tetos para o plano vigente e desliga o que não couber.
     *
     * Sem isto, descer de plano desconectaria números no mesmo instante — e o
     * cliente perderia, no dia 2, vinte e oito dias de capacidade comprada.
     */
    somenteRegistro?: boolean
}): Promise<ResultadoDaAtivacao> {
    const { accountId, workspaceId, plan, ciclo, asaasSubscriptionId, somenteRegistro } = opcoes

    /**
     * O plano **mais** os adicionais contratados.
     *
     * Desde 2026-10-19 cada unidade adicional traz 1 agente, 1 número e 10.000
     * créditos. Aplicar só a tabela do plano faria a troca de plano apagar a
     * capacidade que a clínica comprou à parte — e o sintoma seria um agente
     * pausado logo depois de um upgrade pago.
     */
    const adicionais = await prisma.unitAddon.count({
        where: { accountId, ...adicionaisVivos() },
    })
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
        /**
         * E deixa de estar cancelada.
         *
         * Contratar depois de cancelar é o caminho de quem desistiu da
         * desistência pelo botão de contratar em vez do de desfazer. Sem limpar
         * o carimbo, a tela seguiria mostrando a faixa de cancelamento sobre uma
         * assinatura recém-paga.
         */
        canceledAt: null,
        ...(ciclo ? { billingCycle: ciclo, renewsAt: proximaCobranca(ciclo) } : {}),
        ...(asaasSubscriptionId ? { asaasSubscriptionId } : {}),
    }

    /**
     * No downgrade grava-se **só** o nome do plano e o estado.
     *
     * Os tetos, a franquia e o teto de fala continuam os do plano pago. A
     * leitura em `getWorkspaceLimits` usa o maior entre a cópia e a tabela, então
     * o cliente segue com o que comprou sem nenhum "plano agendado" para
     * ninguém manter.
     */
    const dadosDoDowngrade = {
        plan,
        status: 'active',
        readOnlySince: null,
        canceledAt: null,
        /**
         * O ciclo acompanha o registro, mas a data da cobrança **não**.
         *
         * Descer de plano — ou voltar do anual para o mensal — não reinicia a
         * cobrança: o cliente pagou o período e usa o período. Mover `renewsAt`
         * para trinta dias à frente faria o cliente anual ser cobrado de novo
         * onze meses antes da hora.
         */
        ...(ciclo ? { billingCycle: ciclo } : {}),
        ...(asaasSubscriptionId ? { asaasSubscriptionId } : {}),
    }

    await prisma.subscription.upsert({
        where: { accountId },
        create: {
            accountId,
            ...dados,
            currentPeriodStart: new Date(),
            currentPeriodEnd: renewalDate(),
            /** A franquia é de 30 dias; a cobrança, do ciclo contratado. */
            renewsAt: proximaCobranca(ciclo ?? 'monthly'),
        },
        /**
         * O período **não** é reiniciado na troca de plano: a renovação continua
         * contada da assinatura, como diz PRODUCT.md §2. Na primeira ativação
         * ele nasce no `create` acima.
         */
        update: somenteRegistro ? dadosDoDowngrade : dados,
    })

    /**
     * E o treinamento que o plano de topo em 12 meses inclui.
     *
     * Antes do `somenteRegistro` porque o brinde segue a **contratação**, não o
     * ajuste de tetos: quem assina Multiclínica anual tem direito a ele mesmo
     * quando vem de um plano maior e os limites só caem na renovação.
     */
    const treinamentoConcedido = await concederTreinamentoDoPlano({
        accountId,
        plan,
        ciclo: ciclo ?? null,
    })

    if (somenteRegistro) {
        console.info(
            `[APLICAR_PLANO] conta ${accountId} passa a ${plan} no próximo ciclo; ` +
                'tetos e franquia continuam os do plano pago até a renovação'
        )
        return {
            agentsPaused: 0,
            agentsReleased: 0,
            numbersPaused: 0,
            notas: [],
            treinamentoConcedido,
        }
    }

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

    if (treinamentoConcedido) {
        notas.push('o treinamento de 1 agente entrou incluído no plano')
    }

    return { ...ajuste, notas, treinamentoConcedido }
}

/**
 * Concede o treinamento que o plano de topo em 12 meses inclui — uma vez só.
 *
 * **Idempotente pela origem**, e isto não é zelo: o webhook é at-least-once e
 * `CHECKOUT_PAID` pode chegar duas vezes, então contar quantos existem antes de
 * criar é a diferença entre um brinde e dois. A contagem é só dos de origem
 * `plan`: treinamento que o cliente **comprou** não desconta o que o plano dá.
 *
 * Renovar não concede de novo — a renovação não passa por aqui com ciclo em
 * mãos, e por isso o brinde é de contratação, não anuidade. Se um dia a
 * renovação anual tiver de renovar o brinde, é aqui que a regra muda, com a
 * contagem passando a olhar `createdAt`.
 */
async function concederTreinamentoDoPlano(opcoes: {
    accountId: string
    plan: PlanId
    ciclo: BillingCycle | null
}): Promise<boolean> {
    const { accountId, plan, ciclo } = opcoes

    /**
     * Sem ciclo em mãos, lê o que está gravado.
     *
     * É o caminho da ativação que não decide ciclo (renovação, ajuste de
     * registro): o direito ao brinde é do contrato vigente, e o contrato vigente
     * está na assinatura.
     */
    const vigente =
        ciclo ??
        cicloDe(
            (
                await prisma.subscription.findUnique({
                    where: { accountId },
                    select: { billingCycle: true },
                })
            )?.billingCycle
        )

    const quantos = treinamentoIncluido(plan, vigente)
    if (quantos < 1) return false

    const jaTem = await prisma.trainingAddon.count({
        where: { accountId, origin: 'plan' },
    })
    if (jaTem >= quantos) return false

    await prisma.trainingAddon.create({
        data: { accountId, origin: 'plan', priceCents: 0, status: 'pending' },
    })

    console.info(
        `[APLICAR_PLANO] conta ${accountId}: treinamento de agente incluído pelo ` +
            `plano ${plan} anual`
    )

    return true
}
