/**
 * Só `plan-limits`, nunca `plans`: o worker chama estas contas, e `plans.ts`
 * arrasta ícones do Lucide. Mesma razão que já separou nomes e limites.
 */
import {
    CICLOS,
    PLAN_PRICES,
    PRECO_ADICIONAL,
    valorDaFatura,
    type BillingCycle,
    type PlanId,
} from '@/lib/plan-limits'

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
 * Quanto de um valor mensal cabe nos dias que faltam do ciclo pago.
 *
 * A conta é uma só e serve a dois casos: a diferença de um upgrade e a unidade
 * adicional contratada no meio do mês. Separá-la daqui foi o que impediu a
 * segunda de nascer com uma regra de arredondamento própria — duas contas de
 * proporcional no mesmo sistema divergem no dia em que alguém corrige uma.
 *
 * `agora` e as datas entram como parâmetro para a conta ser testável sem
 * esperar um mês passar.
 */
export function proporcionalDoCiclo(opcoes: {
    /**
     * O valor cheio **do período** — um mês no ciclo mensal, doze no anual.
     *
     * Era `valorMensal`, e o nome mentiu no dia em que o ciclo anual nasceu: a
     * conta é "quanto deste valor cabe nos dias que faltam", e ela não sabe
     * quantos meses o valor cobre. Zero ou negativo não gera cobrança.
     */
    valorDoCiclo: number
    inicioDoCiclo: Date | null
    fimDoCiclo: Date | null
    agora: Date
}): Proporcional {
    const { valorDoCiclo, inicioDoCiclo, fimDoCiclo, agora } = opcoes

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

    // Descer não gera cobrança: a diferença negativa não vira crédito nem
    // devolução. O cliente usa o que pagou até o fim do ciclo.
    if (valorDoCiclo <= 0) {
        return { valor: 0, diasRestantes, diasDoCiclo, abaixoDoMinimo: false }
    }

    const bruto = (valorDoCiclo * Math.min(diasRestantes, diasDoCiclo)) / diasDoCiclo
    const valor = Math.round(bruto * 100) / 100

    if (valor < MINIMO_DO_ASAAS) {
        return { valor: 0, diasRestantes, diasDoCiclo, abaixoDoMinimo: true }
    }

    return { valor, diasRestantes, diasDoCiclo, abaixoDoMinimo: false }
}

/**
 * A diferença proporcional aos dias que faltam do ciclo pago.
 *
 * Os adicionais entram nos dois lados da subtração e se cancelam — ficam no
 * cálculo porque a mensalidade é o conceito que o resto do sistema usa, e tirar
 * um termo que se cancela só economiza caracteres.
 */
export function diferencaProporcional(opcoes: {
    atual: PlanId
    novo: PlanId
    adicionais: number
    inicioDoCiclo: Date | null
    fimDoCiclo: Date | null
    agora: Date
}): Proporcional {
    const { atual, novo, adicionais, ...ciclo } = opcoes

    return proporcionalDoCiclo({
        valorDoCiclo: mensalidade(novo, adicionais) - mensalidade(atual, adicionais),
        ...ciclo,
    })
}

/**
 * O que uma unidade adicional custa agora, contratada no meio do ciclo.
 *
 * Mesma regra do upgrade, e pela mesma razão: ela passa a valer hoje e a
 * renovação já vai cobrar o mês inteiro dela. Cobrar R$ 290 cheios no dia 28 do
 * ciclo seria cobrar duas vezes os mesmos dois dias.
 */
export function proporcionalDoAdicional(opcoes: {
    unidades: number
    inicioDoCiclo: Date | null
    fimDoCiclo: Date | null
    agora: Date
}): Proporcional {
    const { unidades, ...ciclo } = opcoes
    return proporcionalDoCiclo({
        valorDoCiclo: Math.max(0, unidades) * PRECO_ADICIONAL,
        ...ciclo,
    })
}

/**
 * O que a conta contrata: um plano **e** um ciclo de cobrança.
 *
 * Os dois juntos num tipo porque trocar de ciclo e trocar de plano são a mesma
 * decisão na tela — o cliente escolhe "Multiclínica, anual" num gesto — e
 * porque o preço só existe com os dois em mãos.
 */
export interface Contrato {
    plan: PlanId
    ciclo: BillingCycle
}

/**
 * Para que lado a troca vai, agora que o ciclo também muda.
 *
 * `novo-ciclo` é o caso que não existia: passar de mensal para anual não é subir
 * de plano nem descer — é assumir doze meses de compromisso em troca de 10%. Ele
 * **cobra agora** e reinicia o ciclo de cobrança, descontando o que sobrou do
 * mês pago.
 *
 * O contrário — anual para mensal — é `downgrade`, e por isso vale só na
 * renovação: quem pagou doze meses usa os doze meses. Devolver a diferença
 * exigiria estornar parte de uma fatura paga, e isso não é botão de tela.
 */
export type DirecaoDoContrato = Direcao | 'novo-ciclo'

export function direcaoDoContrato(
    atual: Contrato | null,
    novo: Contrato
): DirecaoDoContrato {
    if (!atual) return 'primeira'
    if (atual.plan === novo.plan && atual.ciclo === novo.ciclo) return 'igual'

    if (atual.ciclo !== novo.ciclo) {
        return novo.ciclo === 'annual' ? 'novo-ciclo' : 'downgrade'
    }

    return direcaoDaTroca(atual.plan, novo.plan)
}

/**
 * Quanto cobrar agora para passar de um contrato ao outro.
 *
 * Três desfechos, nesta ordem de leitura:
 *
 * **Mesmo ciclo, subindo de plano** → a diferença dos dias que faltam, que é a
 * regra de 2026-10-19 sem alteração nenhuma. No anual a conta é a mesma com
 * outro período: a diferença entre as duas faturas anuais, proporcional aos dias
 * restantes do ano pago.
 *
 * **Trocando para o anual** → a fatura anual inteira **menos o saldo** do ciclo
 * atual. O cliente pagou um mês e está no dia 10; os vinte dias que sobraram
 * viram abatimento. Sem isso, trocar de ciclo no dia 2 cobraria doze meses em
 * cima de um mês que acabou de ser pago.
 *
 * **Descendo** (plano menor, ou voltando ao mensal) → zero. Vale na renovação.
 */
export function diferencaDeContrato(opcoes: {
    atual: Contrato | null
    novo: Contrato
    adicionais: number
    /** O período de **cobrança** vigente, não o da franquia. */
    inicioDoCiclo: Date | null
    fimDoCiclo: Date | null
    agora: Date
}): { direcao: DirecaoDoContrato; cobranca: Proporcional } {
    const { atual, novo, adicionais, ...periodo } = opcoes
    const direcao = direcaoDoContrato(atual, novo)

    const nada: Proporcional = {
        valor: 0,
        diasRestantes: 0,
        diasDoCiclo: CICLOS[atual?.ciclo ?? 'monthly'].dias,
        abaixoDoMinimo: false,
    }

    if (direcao === 'igual' || direcao === 'downgrade') {
        return { direcao, cobranca: nada }
    }

    /**
     * Primeira contratação: a fatura cheia do ciclo escolhido.
     *
     * Não é proporcional a nada — não há período pago para descontar.
     */
    if (direcao === 'primeira' || !atual) {
        return {
            direcao,
            cobranca: {
                valor: valorDaFatura(novo.plan, adicionais, novo.ciclo),
                diasRestantes: CICLOS[novo.ciclo].dias,
                diasDoCiclo: CICLOS[novo.ciclo].dias,
                abaixoDoMinimo: false,
            },
        }
    }

    if (direcao === 'novo-ciclo') {
        /**
         * O saldo do ciclo atual abate a fatura nova.
         *
         * `proporcionalDoCiclo` é a mesma conta de sempre, usada no outro
         * sentido: ali ela diz "quanto cobrar pelos dias que faltam", aqui diz
         * "quanto o cliente já pagou pelos dias que faltam". É o mesmo número.
         *
         * O `abaixoDoMinimo` do saldo é ignorado de propósito: ele serve para
         * decidir se vale cobrar, e o que se faz aqui com o saldo é subtrair.
         * Um saldo de R$ 3 que virasse zero cobraria R$ 3 a mais do cliente.
         */
        const DIA = 86_400_000
        const diasDoCiclo =
            periodo.inicioDoCiclo && periodo.fimDoCiclo
                ? Math.max(
                      1,
                      Math.round(
                          (periodo.fimDoCiclo.getTime() - periodo.inicioDoCiclo.getTime()) / DIA
                      )
                  )
                : CICLOS[atual.ciclo].dias
        const diasRestantes = periodo.fimDoCiclo
            ? Math.max(0, Math.ceil((periodo.fimDoCiclo.getTime() - periodo.agora.getTime()) / DIA))
            : 0

        const pagoDoCicloAtual = valorDaFatura(atual.plan, adicionais, atual.ciclo)
        const saldo =
            Math.round(
                ((pagoDoCicloAtual * Math.min(diasRestantes, diasDoCiclo)) / diasDoCiclo) * 100
            ) / 100

        const bruto = valorDaFatura(novo.plan, adicionais, novo.ciclo) - saldo
        const valor = Math.max(0, Math.round(bruto * 100) / 100)

        return {
            direcao,
            cobranca: {
                valor: valor < MINIMO_DO_ASAAS ? 0 : valor,
                diasRestantes,
                diasDoCiclo,
                abaixoDoMinimo: valor < MINIMO_DO_ASAAS,
            },
        }
    }

    // Upgrade dentro do mesmo ciclo: a diferença das duas faturas, proporcional.
    return {
        direcao,
        cobranca: proporcionalDoCiclo({
            valorDoCiclo:
                valorDaFatura(novo.plan, adicionais, novo.ciclo) -
                valorDaFatura(atual.plan, adicionais, atual.ciclo),
            ...periodo,
        }),
    }
}

/**
 * A data da próxima **cobrança**, contada do contrato.
 *
 * Separada de `renewalDate` (que é a franquia de 30 dias, em `lib/billing`) pela
 * razão que criou a coluna `renewsAt`: no anual as duas datas se afastam, e
 * reusar uma para a outra faria o cliente anual ser cobrado doze vezes.
 */
export function proximaCobranca(ciclo: BillingCycle, de: Date = new Date()): Date {
    return new Date(de.getTime() + CICLOS[ciclo].dias * 86_400_000)
}

/**
 * Quando o ciclo de cobrança vigente começou, deduzido do fim dele.
 *
 * Não há coluna de início da cobrança, e não precisa haver: `renewsAt` só é
 * movida em passos de `CICLOS[ciclo].dias`, então o começo é o fim menos um
 * passo. Uma coluna a mais seria uma segunda verdade para manter alinhada — e a
 * aritmética aqui é exata, não aproximação.
 *
 * Importa porque o proporcional precisa saber o tamanho do período: usar o
 * `currentPeriodStart` da franquia num ciclo anual diria "ciclo de 30 dias" e
 * cobraria doze vezes a diferença certa.
 */
export function inicioDaCobranca(
    ciclo: BillingCycle,
    fim: Date | null | undefined
): Date | null {
    return fim ? new Date(fim.getTime() - CICLOS[ciclo].dias * 86_400_000) : null
}
