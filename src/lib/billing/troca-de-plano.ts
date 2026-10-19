/**
 * Só `plan-limits`, nunca `plans`: o worker chama estas contas, e `plans.ts`
 * arrasta ícones do Lucide. Mesma razão que já separou nomes e limites.
 */
import { PLAN_PRICES, PRECO_ADICIONAL, type PlanId } from '@/lib/plan-limits'

/**
 * A aritmética de trocar de plano no meio de um ciclo pago.
 *
 * Pura e sem banco, porque é a conta que erra calado — e porque ela precisa ser
 * conferível em `npm run check:period`, que é onde mora o que erra calado.
 *
 * A REGRA, DECIDIDA PELO ANDRE EM 2026-10-19
 *
 * **Descer não cobra.** Quem pagou o ciclo usa o que pagou até o fim dele: o
 * plano muda na hora no registro, o preço muda na renovação, e os recursos do
 * plano superior continuam valendo até lá. Na virada o cron desliga o que não
 * couber — inclusive desconectar números, que é o caso de Multiclínica (6) para
 * Digital com dois adicionais (3).
 *
 * **Subir cobra a diferença dos dias que faltam**, e entrega na hora. Cobrar o
 * mês cheio de novo seria cobrar duas vezes o mesmo período; esperar o ciclo
 * seria dizer "pague agora, receba em vinte dias".
 */

/** Quanto o plano custa por mês, com os adicionais somados. */
export function mensalidade(plan: PlanId, adicionais: number): number {
    return PLAN_PRICES[plan] + Math.max(0, adicionais) * PRECO_ADICIONAL
}

export type Direcao = 'primeira' | 'upgrade' | 'downgrade' | 'igual'

/** Para que lado a troca vai, pelo preço do **plano** — adicionais não mudam. */
export function direcaoDaTroca(atual: PlanId | null, novo: PlanId): Direcao {
    if (!atual) return 'primeira'
    if (atual === novo) return 'igual'
    return PLAN_PRICES[novo] > PLAN_PRICES[atual] ? 'upgrade' : 'downgrade'
}

export interface Proporcional {
    /** Quanto cobrar agora, em reais. Zero quando não se cobra. */
    valor: number
    diasRestantes: number
    diasDoCiclo: number
    /**
     * Abaixo do mínimo do Asaas (R$ 5), não se cobra nada e o upgrade entra
     * assim mesmo.
     *
     * Forçar uma cobrança de R$ 5 por uma diferença de R$ 3 é cobrar a mais
     * para respeitar um limite do gateway — e a diferença some na primeira
     * renovação cheia, que é logo ali.
     *
     * Com os preços de hoje isso só acontece na virada exata: um dia restante
     * de uma diferença de R$ 300 já dá R$ 10. A trava existe para o dia em que
     * os preços se aproximarem, não para o caso comum.
     */
    abaixoDoMinimo: boolean
}

/** O mínimo que o Asaas aceita por cobrança, medido contra o sandbox. */
export const MINIMO_DO_ASAAS = 5

/**
 * A diferença proporcional aos dias que faltam do ciclo pago.
 *
 * `agora` e as datas entram como parâmetro para a conta ser testável sem
 * esperar um mês passar.
 */
export function diferencaProporcional(opcoes: {
    atual: PlanId
    novo: PlanId
    adicionais: number
    inicioDoCiclo: Date | null
    fimDoCiclo: Date | null
    agora: Date
}): Proporcional {
    const { atual, novo, adicionais, inicioDoCiclo, fimDoCiclo, agora } = opcoes

    const DIA = 86_400_000

    /**
     * Sem período gravado, assume-se um ciclo de 30 dias inteiro pela frente.
     *
     * É o caso da assinatura antiga, criada antes de o período existir. Assumir
     * o ciclo cheio cobra o máximo possível — e, entre errar a favor do cliente
     * e contra, aqui a escolha é a favor: 30 dias restantes significa que a
     * diferença cobrada é a diferença integral, que é o que ele passaria a pagar
     * de qualquer forma.
     */
    const diasDoCiclo =
        inicioDoCiclo && fimDoCiclo
            ? Math.max(1, Math.round((fimDoCiclo.getTime() - inicioDoCiclo.getTime()) / DIA))
            : 30

    const diasRestantes = fimDoCiclo
        ? Math.max(0, Math.ceil((fimDoCiclo.getTime() - agora.getTime()) / DIA))
        : diasDoCiclo

    const diferencaMensal = mensalidade(novo, adicionais) - mensalidade(atual, adicionais)

    // Descer não gera cobrança: a diferença negativa não vira crédito nem
    // devolução. O cliente usa o que pagou até o fim do ciclo.
    if (diferencaMensal <= 0) {
        return { valor: 0, diasRestantes, diasDoCiclo, abaixoDoMinimo: false }
    }

    const bruto = (diferencaMensal * Math.min(diasRestantes, diasDoCiclo)) / diasDoCiclo
    const valor = Math.round(bruto * 100) / 100

    if (valor < MINIMO_DO_ASAAS) {
        return { valor: 0, diasRestantes, diasDoCiclo, abaixoDoMinimo: true }
    }

    return { valor, diasRestantes, diasDoCiclo, abaixoDoMinimo: false }
}
