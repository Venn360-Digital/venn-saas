/**
 * Os limites de cada plano, sem nada de interface.
 *
 * Existe separado de `plans.ts` porque o worker precisa deles e `plans.ts`
 * importa ícones do Lucide para a fileira de canais — componentes de React num
 * processo Node que nunca desenha nada. O que o worker precisa é o número.
 *
 * **Esta é a fonte da verdade.** A assinatura guarda uma cópia destes valores,
 * escrita quando o plano é escolhido, e durante meses essa cópia era o que
 * valia para sempre: a renovação zerava o consumo e nunca atualizava a franquia,
 * então mudar o número aqui só alcançava cliente novo. Desde 2026-10-15 a
 * renovação relê este arquivo — ver `processors/cron/credits-reset.ts`.
 */

export type PlanId = 'flow' | 'pro' | 'advanced'

export interface PlanLimits {
    maxAgents: number
    maxWhatsAppNumbers: number
    /**
     * Quantas unidades (clínicas) a conta pode abrir pelo plano.
     *
     * **Não tem coluna na assinatura, de propósito.** `maxAgents` e companhia
     * têm, por razão histórica, e essa cópia já custou um defeito: ficava
     * congelada na contratação e mudar o número aqui só alcançava cliente novo.
     * Este é lido do plano a cada consulta, então mudar a tabela comercial vale
     * para todo mundo no mesmo instante.
     *
     * O teto real da conta é este **mais** as unidades compradas à parte
     * (`unit_addons`) — ver `unidadesDaConta`.
     */
    maxWorkspaces: number
    /**
     * Franquia mensal de crédito. **Um crédito é uma resposta do agente**, e a
     * conversão não vai para a tabela comercial: publicá-la convida o cliente a
     * dividir a mensalidade por ela e chegar a cinco centavos.
     *
     * Dimensionada em ~1,8x o uso provável (20/40/60 atendimentos por dia × 30
     * dias × 9,25 respostas), o que põe o cliente típico em 56% da franquia.
     */
    credits: number
    maxMessages: number
    /**
     * Quantas respostas o agente pode **falar** no mês.
     *
     * Teto, e não peso no crédito: a fala custa cerca de dez vezes o texto, e
     * cobrar 2 créditos por resposta falada deixava a carteira imprevisível para
     * quem olha a tela. É este teto que fecha o pior caso dentro dos 10% da
     * mensalidade destinados a custo de IA.
     */
    maxSpokenReplies: number
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
    flow: {
        maxWorkspaces: 1,
        maxAgents: 1,
        maxWhatsAppNumbers: 1,
        credits: 10_000,
        maxMessages: 10_000,
        maxSpokenReplies: 400,
    },
    pro: {
        maxWorkspaces: 1,
        maxAgents: 2,
        maxWhatsAppNumbers: 4,
        credits: 20_000,
        maxMessages: 20_000,
        maxSpokenReplies: 750,
    },
    advanced: {
        maxWorkspaces: 3,
        maxAgents: 3,
        maxWhatsAppNumbers: 6,
        credits: 30_000,
        maxMessages: 30_000,
        maxSpokenReplies: 1_500,
    },
}

export function isPlanId(id: string | null | undefined): id is PlanId {
    return id === 'flow' || id === 'pro' || id === 'advanced'
}

/** Os limites do plano, caindo no menor quando o id não é reconhecido. */
export function limitsFor(id: string | null | undefined): PlanLimits {
    return isPlanId(id) ? PLAN_LIMITS[id] : PLAN_LIMITS.flow
}

/**
 * Quantas unidades a conta pode ter: o que o plano inclui mais as compradas.
 *
 * Aqui e não inline porque **três lugares precisam concordar**: a tela que
 * mostra "1 de 3", a trava dentro da transação que cria a unidade, e a recusa
 * de descer de plano. Três cópias da mesma soma é a forma mais barata de a
 * clínica ver um teto e encontrar outro — ou de ganhar uma unidade de graça.
 *
 * É pura de propósito: sem banco, dá para conferir a conta em
 * `npm run check:period`, que é onde mora o que erra calado.
 */
export function tetoDeUnidades(plan: string | null | undefined, adicionais: number): number {
    return limitsFor(plan).maxWorkspaces + Math.max(0, adicionais)
}
