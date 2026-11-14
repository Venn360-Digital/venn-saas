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
    /**
     * Quantos destinatários de broadcast a conta pode disparar no mês.
     *
     * Teto separado do `maxMessages` do atendimento: um disparo de campanha não
     * pode consumir, de uma vez, a franquia de conversa que a clínica precisa no
     * dia a dia. Zero desliga o broadcast no plano. Ver DUVIDAS-B2.md D1 — a
     * contagem de custo por mensagem da Meta é à parte.
     */
    maxBroadcastRecipientsPerMonth: number

    /**
     * Destinatários de campanha de **e-mail** por mês, na conta.
     *
     * Contador próprio, e não o mesmo balde do WhatsApp — decisão dele em
     * 2026-11-08. O motivo é o custo, que difere em **duas ordens de
     * grandeza**: uma mensagem de marketing no WhatsApp custa R$ 0,3217 à
     * clínica (preço da Meta, Brasil, desde 01/10/2026), e um e-mail custa
     * cerca de R$ 0,0009 (US$ 0,16/1.000 no plano Essentials do SES).
     *
     * Um teto só obrigaria a calibrá-lo pelo canal caro, e o e-mail — que é
     * praticamente de graça — ficaria artificialmente apertado. Com dois, cada
     * um fica no tamanho do que custa.
     *
     * Zero desliga a campanha de e-mail no plano.
     */
    maxEmailsPerMonth: number
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
    flow: {
        maxWorkspaces: 1,
        maxAgents: 1,
        maxWhatsAppNumbers: 1,
        credits: 10_000,
        maxMessages: 10_000,
        maxSpokenReplies: 400,
        maxBroadcastRecipientsPerMonth: 1_000,
        maxEmailsPerMonth: 10_000,
    },
    pro: {
        maxWorkspaces: 1,
        maxAgents: 2,
        maxWhatsAppNumbers: 4,
        credits: 20_000,
        maxMessages: 20_000,
        maxSpokenReplies: 750,
        maxBroadcastRecipientsPerMonth: 5_000,
        maxEmailsPerMonth: 50_000,
    },
    advanced: {
        maxWorkspaces: 3,
        maxAgents: 3,
        maxWhatsAppNumbers: 6,
        credits: 30_000,
        maxMessages: 30_000,
        maxSpokenReplies: 1_500,
        maxBroadcastRecipientsPerMonth: 20_000,
        maxEmailsPerMonth: 200_000,
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

/**
 * O preço mensal de cada plano, e o do adicional.
 *
 * Aqui pela mesma razão dos nomes: o **worker** precisa deles para recalcular o
 * valor da assinatura numa troca de plano, e `plans.ts` arrasta ícones do
 * Lucide. `plans.ts` lê daqui, então o preço continua tendo um lugar só.
 */
export const PLAN_PRICES: Record<PlanId, number> = {
    flow: 390,
    pro: 590,
    advanced: 890,
}

/** A unidade adicional, por mês. Ver `ADICIONAL_INCLUI` para o que ela traz. */
export const PRECO_ADICIONAL = 290

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
 * | 2 agentes | Prime R$ 590, **4 números, 20k** | R$ 680, 2 números, 10k |
 * | 3 agentes | Multiclínica R$ 890, **6 números, 30k** | R$ 970, 3 números, 10k |
 *
 * **CRÉDITO NÃO VEM NO ADICIONAL — decisão do Andre em 2026-10-19.**
 *
 * Veio por algumas horas, e a razão de sair é que o crédito já se compra
 * separado: 10.000 avulsos custam R$ 49, então expandir sai por R$ 290 + R$ 49
 * = R$ 339, ainda abaixo dos R$ 390 de uma assinatura Digital nova. Embutir a
 * franquia no adicional dava de graça o que o cliente compra por R$ 49 — e
 * criava uma terceira origem de crédito para a clínica entender.
 *
 * O que o adicional resolve é **separar unidade**, que é o problema de quem tem
 * quatro clínicas e não quer quatro contas. Então ele traz capacidade — a
 * unidade, o agente e o número, sem os quais a clínica nova fica muda — e o
 * consumo continua vindo de duas caixas d'água só: a franquia do plano e o
 * avulso.
 *
 * `maxSpokenReplies` segue o crédito, não o agente: fala é consumo, e consumo
 * sai da franquia do plano.
 */
export const ADICIONAL_INCLUI = {
    maxWorkspaces: 1,
    maxAgents: 1,
    maxWhatsAppNumbers: 1,
    credits: 0,
    maxMessages: 0,
    maxSpokenReplies: 0,
    maxBroadcastRecipientsPerMonth: 0,
    /**
     * Zero, como os outros contadores de consumo. O adicional vende **unidade**
     * — mais uma clínica na conta —, não mais alcance de campanha: as unidades
     * novas dividem o mesmo teto mensal da conta.
     */
    maxEmailsPerMonth: 0,
} satisfies PlanLimits

/**
 * Os limites efetivos da conta: o plano mais o que os adicionais trazem.
 *
 * É a fonte única dessa soma. Antes só as unidades somavam (`tetoDeUnidades`), e
 * agora são sete campos — espalhar isso por rota, worker e tela seria garantir
 * que um dos três esquecesse um deles.
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
        maxBroadcastRecipientsPerMonth:
            base.maxBroadcastRecipientsPerMonth +
            n * ADICIONAL_INCLUI.maxBroadcastRecipientsPerMonth,
        maxEmailsPerMonth: base.maxEmailsPerMonth + n * ADICIONAL_INCLUI.maxEmailsPerMonth,
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

/**
 * Mensal ou anual — e o que o anual desconta.
 *
 * Decisão do Andre em 2026-11-07: **10% em todos os planos** na assinatura de
 * 12 meses. Um número só, igual para os três, porque desconto que varia por
 * plano transforma a escada em tabela — e a escada é o que faz o cliente subir.
 *
 * Mora aqui, com os preços, pela mesma razão que eles: o **worker** precisa
 * recalcular o valor da recorrência numa troca, e `plans.ts` arrasta ícones do
 * Lucide.
 *
 * **O ciclo é de cobrança, não de franquia.** O crédito continua renovando de
 * 30 em 30 dias em qualquer um dos dois: quem paga 12 meses adiantado não
 * recebe 12 × 10.000 créditos de uma vez para gastar em janeiro. Por isso a
 * assinatura passou a ter duas datas — `currentPeriodEnd`, que é a franquia, e
 * `renewsAt`, que é a cobrança. Ver `credits-reset.ts`.
 */
export type BillingCycle = 'monthly' | 'annual'

/** O desconto da assinatura de 12 meses, em todos os planos. */
export const DESCONTO_ANUAL = 0.1

export interface Ciclo {
    /** Quantos meses a fatura cobre. */
    meses: number
    /** Abatimento sobre o preço de tabela, de 0 a 1. */
    desconto: number
    /** Para o rótulo da tela. */
    label: string
    /** Como o Asaas chama a recorrência. */
    asaas: 'MONTHLY' | 'YEARLY'
    /**
     * Quantos dias o ciclo de **cobrança** dura.
     *
     * 365 e não "um ano de calendário": é a mesma escolha que fez o mensal ser
     * 30 dias contados da contratação (ver `RENEWAL_DAYS`), e manter as duas
     * contas na mesma aritmética é o que impede a renovação anual de cair num
     * 29 de fevereiro que não existe.
     */
    dias: number
}

export const CICLOS: Record<BillingCycle, Ciclo> = {
    monthly: { meses: 1, desconto: 0, label: 'Mensal', asaas: 'MONTHLY', dias: 30 },
    annual: { meses: 12, desconto: DESCONTO_ANUAL, label: 'Anual', asaas: 'YEARLY', dias: 365 },
}

export function isBillingCycle(v: string | null | undefined): v is BillingCycle {
    return v === 'monthly' || v === 'annual'
}

/** O ciclo, caindo no mensal quando o valor guardado não é reconhecido. */
export function cicloDe(v: string | null | undefined): BillingCycle {
    return isBillingCycle(v) ? v : 'monthly'
}

/** Centavos exatos: a conta passa por `value` do Asaas, que recusa dízima. */
function emReais(valor: number): number {
    return Math.round(valor * 100) / 100
}

/**
 * O que **uma fatura** cobra: a mensalidade × meses, menos o desconto do ciclo.
 *
 * É este o número que vai para o `value` da recorrência no Asaas — no anual, a
 * cobrança é uma por ano e carrega os doze meses de uma vez.
 */
export function valorDaFatura(
    plan: string | null | undefined,
    adicionais: number,
    ciclo: BillingCycle
): number {
    const { meses, desconto } = CICLOS[ciclo]
    const mensal =
        PLAN_PRICES[isPlanId(plan) ? plan : 'flow'] + Math.max(0, adicionais) * PRECO_ADICIONAL

    return emReais(mensal * meses * (1 - desconto))
}

/**
 * O mensal equivalente do ciclo — o número que o cartão de plano compara.
 *
 * A tela mostra "R$ 801/mês, cobrados R$ 9.612 por ano" e não só o total: o
 * cliente escolhe plano comparando mensalidades, e substituir a mensalidade
 * pelo total anual faz o Multiclínica parecer dez vezes mais caro que o Prime.
 */
export function mensalEquivalente(
    plan: string | null | undefined,
    adicionais: number,
    ciclo: BillingCycle
): number {
    return emReais(valorDaFatura(plan, adicionais, ciclo) / CICLOS[ciclo].meses)
}

/** Quanto o ciclo anual economiza por ano, para a tela poder dizer. */
export function economiaDoAnual(plan: string | null | undefined, adicionais: number): number {
    return emReais(valorDaFatura(plan, adicionais, 'monthly') * 12 - valorDaFatura(plan, adicionais, 'annual'))
}

/**
 * O treinamento do agente, vendido à parte.
 *
 * **Serviço, não recurso do sistema**: a nossa equipe levanta o conteúdo da
 * {@link https://odontobox.venn360.com/suporte | base} com a clínica, escreve
 * os sete documentos e afina o agente até ele responder como a clínica
 * responderia. Não se confunde com a tela **Treinamento**, que é onde o cliente
 * faz isso por conta própria — e é justamente por ela existir que o adicional
 * precisa dizer, em letra, que o que se compra é o trabalho.
 *
 * **Compra única.** Não entra na mensalidade: treinar é um projeto com começo e
 * fim, e cobrar por mês um trabalho que acabou é assinatura de nada.
 *
 * O preço de tabela e o promocional vêm do Andre em 2026-11-07. A promoção foi
 * pedida "até 31/11/2026", data que não existe — novembro tem 30 dias —, e
 * ficou no **último dia de novembro**, que é a leitura que não encurta nem
 * estende o que ele pediu.
 */
export const TREINAMENTO = {
    nome: 'Treinamento de agente',
    precoCheio: 3400,
    precoPromocional: 2400,
    /** Último dia válido da promoção, no calendário de São Paulo. */
    promoAte: '2026-11-30',
    /** Quantos cabem numa compra. Mais que isto é projeto, e projeto é conversa. */
    maximoPorCompra: 5,
} as const

export interface PrecoDoTreinamento {
    /** O que se cobra hoje, por agente. */
    valor: number
    /** O de tabela, para a tela riscar. */
    cheio: number
    /** Se a promoção está valendo agora. */
    promocional: boolean
    /** O último dia da promoção, "AAAA-MM-DD". */
    promoAte: string
}

/**
 * O preço do treinamento hoje — puro, para a tela e o servidor concordarem.
 *
 * A comparação é pelo **dia em São Paulo**, e não por `Date` cru: o Worker roda
 * em UTC (ver `fuso-workers`), e às 22h do dia 30 em São Paulo já é dia 1º em
 * UTC — a promoção terminaria duas horas antes para quem está no Brasil.
 */
export function precoDoTreinamento(agora: Date = new Date()): PrecoDoTreinamento {
    const hoje = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const promocional = hoje <= TREINAMENTO.promoAte

    return {
        valor: promocional ? TREINAMENTO.precoPromocional : TREINAMENTO.precoCheio,
        cheio: TREINAMENTO.precoCheio,
        promocional,
        promoAte: TREINAMENTO.promoAte,
    }
}

/**
 * Quantos treinamentos o plano **dá** — zero, ou um.
 *
 * Decisão do Andre em 2026-11-07: o **plano de topo** inclui o treinamento de
 * 1 agente **na assinatura de 12 meses**. É sempre o `advanced`, qualquer que
 * seja o nome comercial que ele tenha nesta tabela.
 *
 * As duas condições juntas, e não uma delas: no mensal o cliente pode sair no
 * mês seguinte levando um serviço de R$ 2.400, e aí o brinde custa mais que a
 * assinatura que ele pagou. É o compromisso de doze meses que o financia.
 */
export function treinamentoIncluido(
    plan: string | null | undefined,
    ciclo: BillingCycle
): number {
    return plan === 'advanced' && ciclo === 'annual' ? 1 : 0
}
