import prisma from '@/lib/prisma'

/**
 * Quem é cobrado, quem não é, e desde quando.
 *
 * Duas decisões do Andre moram aqui, e as duas existem porque o produto rodou de
 * graça antes de a cobrança existir:
 *
 * **Conta vitalícia** (`billingExempt`): a Venn360 é a conta de teste do
 * produto. Usa tudo e nunca é cobrada. É marca explícita e não assinatura falsa
 * com renovação eterna — essa os relatórios somariam como receita.
 *
 * **Data de início** (`billingStartsAt`): a Implante Ja usava de graça e passa a
 * ser cobrada em 27/10/2026. Antes da data o sistema não cobra e não corta.
 *
 * As duas são da **conta**, porque quem paga é a conta.
 */

export interface RegimeDeCobranca {
    /** Se uma contratação agora passa pelo checkout, ou ativa direto. */
    precisaPagar: boolean
    /** Por que não precisa, para a tela poder dizer. */
    motivo: 'vitalicia' | 'antes_da_data' | null
    /** Quando passa a ser cobrada, quando a razão é a data. */
    a_partir_de: Date | null
}

export async function regimeDaConta(accountId: string): Promise<RegimeDeCobranca> {
    const conta = await prisma.account.findUnique({
        where: { id: accountId },
        select: { billingExempt: true, billingStartsAt: true },
    })

    if (!conta) {
        // Conta que não existe não é isenta: é erro de quem chamou, e deixar
        // passar como "não precisa pagar" daria plano de graça por acidente.
        return { precisaPagar: true, motivo: null, a_partir_de: null }
    }

    if (conta.billingExempt) {
        return { precisaPagar: false, motivo: 'vitalicia', a_partir_de: null }
    }

    if (conta.billingStartsAt && conta.billingStartsAt.getTime() > Date.now()) {
        return {
            precisaPagar: false,
            motivo: 'antes_da_data',
            a_partir_de: conta.billingStartsAt,
        }
    }

    return { precisaPagar: true, motivo: null, a_partir_de: null }
}
