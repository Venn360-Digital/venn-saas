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

/**
 * O nome comercial de cada plano.
 *
 * Mora aqui, e não em `plans.ts`, porque o **worker** precisa dele e `plans.ts`
 * arrasta ícones do Lucide — React num processo que nunca desenha nada. Era
 * `planFor(...).name`, e foi esse import que fez o compilador do worker recusar
 * `lib/limits` inteiro quando ele passou a ser usado na ativação de plano.
 *
 * `plans.ts` lê daqui, então continua havendo um só lugar onde o nome muda.
 */
export const PLAN_NAMES: Record<PlanId, string> = {
    flow: 'Plano Digital',
    pro: 'Plano Prime',
    advanced: 'Plano Multiclínica',
}

/** O nome do plano, caindo no de entrada quando o id não é reconhecido. */
export function planNameFor(id: string | null | undefined): string {
    return PLAN_NAMES[isPlanId(id) ? id : 'flow']
}

export function isPlanId(id: string | null | undefined): id is PlanId {
    return id === 'flow' || id === 'pro' || id === 'advanced'
}

/** Os limites do plano, caindo no menor quando o id não é reconhecido. */
export function limitsFor(id: string | null | undefined): PlanLimits {
    return isPlanId(id) ? PLAN_LIMITS[id] : PLAN_LIMITS.flow
}

/**
 * O que **uma** unidade adicional traz, além da unidade em si.
 *
 * Decidido pelo Andre em 2026-10-19, corrigindo a regra anterior — em que o
 * adicional comprava só separação, sem capacidade nenhuma.
 *
 * A razão é prática: unidade sem agente e sem número é clínica que não atende.
 * O adicional resolvia o problema pela metade, e a conta que descia de plano
 * ficava com uma unidade viva e muda.
 *
 * **Minha objeção original não sobrevivia à aritmética.** Eu argumentei que
 * capacidade no adicional inverteria a escada de planos; não inverte, porque os
 * planos dão **números** desproporcionalmente e o adicional dá um só:
 *
 * | para ter | pelo plano | por Digital + adicionais |
 * |---|---|---|
 * | 2 agentes, 20k | Prime R$ 590, **4 números** | R$ 680, 2 números |
 * | 3 agentes, 30k | Multiclínica R$ 890, **6 números** | R$ 970, 3 números |
 *
 * Em dinheiro e em números o plano ganha nos dois casos. O adicional é o Plano
 * Digital a R$ 290 para quem já assina — que é exatamente o que ele deve ser.
 *
 * `maxSpokenReplies` acompanha porque o teto de fala existe para fechar o custo
 * de IA dentro dos 10% da mensalidade: 10.000 créditos a mais sem fala a mais
 * seria franquia que não pode ser usada como o plano permite; e fala a mais sem
 * teto furaria a margem pelo lado que ninguém olha.
 */
export const ADICIONAL_INCLUI = {
    maxWorkspaces: 1,
    maxAgents: 1,
    maxWhatsAppNumbers: 1,
    credits: 10_000,
    maxMessages: 10_000,
    maxSpokenReplies: 400,
} satisfies PlanLimits

/**
 * Os limites efetivos da conta: o plano mais o que os adicionais trazem.
 *
 * É a fonte única dessa soma. Antes só as unidades somavam (`tetoDeUnidades`), e
 * agora somam cinco coisas — espalhar isso por rota, worker e tela seria
 * garantir que um dos três esquecesse uma delas.
 */
export function limitesEfetivos(
    plan: string | null | undefined,
    adicionais: number
): PlanLimits {
    const base = limitsFor(plan)
    const n = Math.max(0, adicionais)

    return {
        maxWorkspaces: base.maxWorkspaces + n * ADICIONAL_INCLUI.maxWorkspaces,
        maxAgents: base.maxAgents + n * ADICIONAL_INCLUI.maxAgents,
        maxWhatsAppNumbers: base.maxWhatsAppNumbers + n * ADICIONAL_INCLUI.maxWhatsAppNumbers,
        credits: base.credits + n * ADICIONAL_INCLUI.credits,
        maxMessages: base.maxMessages + n * ADICIONAL_INCLUI.maxMessages,
        maxSpokenReplies: base.maxSpokenReplies + n * ADICIONAL_INCLUI.maxSpokenReplies,
    }
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
    return limitesEfetivos(plan, adicionais).maxWorkspaces
}
