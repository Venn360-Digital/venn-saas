import prisma from '@/lib/prisma'
import { asaas } from '@/lib/asaas/client'
import { PLANS, type PlanId } from '@/lib/plans'
import { UNIDADE_ADICIONAL } from '@/lib/plans'

/**
 * O checkout hospedado do Asaas: a página onde o cliente paga.
 *
 * Nós não desenhamos tela de pagamento e não tocamos no número do cartão. O
 * pagador vai para uma página do Asaas, paga por Pix ou cartão, e volta. A
 * alternativa — tokenizar o cartão no nosso servidor — levaria o PAN pelo nosso
 * código e pelos nossos logs, e o escopo de PCI sairia de SAQ A para SAQ A-EP.
 * Ver PRODUCT.md §13.
 *
 * **Criar o checkout não é confirmação financeira**, e a documentação deles diz
 * isso em letra. Quem ativa o plano é o webhook; a volta do pagador para a nossa
 * tela é navegação, não prova — o navegador pode fechar, perder a rede ou ser
 * adulterado.
 */

/** Quanto o plano custa por mês, somadas as unidades adicionais já contratadas. */
export function mensalidadeDoPlano(plan: PlanId, adicionais: number): number {
    return PLANS[plan].price + adicionais * UNIDADE_ADICIONAL.price
}

interface RespostaCheckout {
    id: string
    link: string
    status?: string
}

export interface DadosDoPagador {
    name: string
    cpfCnpj: string
    email: string
    phone?: string | null
}

/**
 * Cria o checkout recorrente de um plano e guarda a tentativa.
 *
 * A ordem é deliberada: **grava a linha primeiro**, com o id que vai no
 * `externalReference`, e só então chama o Asaas. Se a chamada falhar, sobra uma
 * linha sem checkout — visível, descartável, inofensiva. Na ordem inversa
 * sobraria um checkout pago no Asaas que o nosso webhook não saberia a quem
 * atribuir, e isso é dinheiro recebido sem dono.
 *
 * `minutesToExpire` em 24 horas: Pix de assinatura que fica aberto por uma
 * semana é cobrança que o cliente esqueceu que fez. Expirado, a tela oferece
 * contratar de novo.
 */
export async function criarCheckoutDePlano(opcoes: {
    accountId: string
    plan: PlanId
    adicionais: number
    pagador: DadosDoPagador
    /** Para onde o Asaas devolve o pagador. Sem rota, sem volta. */
    baseUrl: string
}): Promise<{ link: string; checkoutId: string }> {
    const { accountId, plan, adicionais, pagador, baseUrl } = opcoes

    const valor = mensalidadeDoPlano(plan, adicionais)
    const planConfig = PLANS[plan]

    /**
     * A primeira cobrança é **hoje**.
     *
     * `nextDueDate` é a data da primeira cobrança da assinatura, e o Asaas só
     * cobra no ato quando ela é o dia corrente. Qualquer data futura criaria uma
     * assinatura válida com plano não pago — e o cliente sairia da tela
     * acreditando que contratou.
     */
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

    const tentativa = await prisma.asaasCheckout.create({
        data: {
            accountId,
            plan,
            // Preenchidos depois da resposta: a linha nasce para ter id.
            asaasCheckoutId: `pendente:${accountId}:${Date.now()}`,
            link: '',
            valueCents: Math.round(valor * 100),
        },
        select: { id: true },
    })

    try {
        const resposta = await asaas<RespostaCheckout>('/checkouts', {
            method: 'POST',
            body: {
                billingTypes: ['PIX', 'CREDIT_CARD'],
                chargeTypes: ['RECURRENT'],
                minutesToExpire: 1440,
                /** Como o webhook descobre qual conta e qual plano foram pagos. */
                externalReference: tentativa.id,
                callback: {
                    successUrl: `${baseUrl}/gerenciamento/conta?tab=plano&pagamento=processando`,
                    cancelUrl: `${baseUrl}/gerenciamento/conta?tab=plano&pagamento=cancelado`,
                    expiredUrl: `${baseUrl}/gerenciamento/conta?tab=plano&pagamento=expirado`,
                },
                items: [
                    {
                        name: planConfig.name,
                        description:
                            adicionais > 0
                                ? `Mensalidade do ${planConfig.name} com ${adicionais} unidade(s) adicional(is)`
                                : `Mensalidade do ${planConfig.name}`,
                        quantity: 1,
                        value: valor,
                    },
                ],
                customerData: {
                    name: pagador.name,
                    cpfCnpj: pagador.cpfCnpj,
                    email: pagador.email,
                    ...(pagador.phone ? { phone: pagador.phone } : {}),
                },
                subscription: {
                    cycle: 'MONTHLY',
                    nextDueDate: hoje,
                },
            },
        })

        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: {
                asaasCheckoutId: resposta.id,
                link: resposta.link,
                status: resposta.status ?? 'ACTIVE',
            },
        })

        return { link: resposta.link, checkoutId: resposta.id }
    } catch (erro) {
        // A tentativa morre junto com a chamada que falhou: deixá-la "ACTIVE"
        // faria a tela anunciar um pagamento em andamento que não existe.
        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: { status: 'CANCELED' },
        })
        throw erro
    }
}
