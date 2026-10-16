import {
    BadgeCheck,
    Facebook,
    Instagram,
    QrCode,
    type LucideIcon,
} from 'lucide-react'

/**
 * The commercial plans, defined once.
 *
 * They were defined twice before — one set in the onboarding step, another in the
 * subscription API — with different names and different prices (97/197/497
 * against 690/890/1290). Whichever screen you happened to open told you something
 * different, and neither matched what the workspace actually got, because
 * onboarding never created a subscription at all.
 *
 * The limits here are not decoration: they are written onto the workspace's
 * subscription when the plan is chosen, and enforced when agents and WhatsApp
 * connections are created.
 */

import { PLAN_LIMITS, type PlanId, type PlanLimits } from '@/lib/plan-limits'

// Reexportados para quem já importava daqui — a definição mora em
// `plan-limits.ts`, que o worker também lê.
export { type PlanId }

export interface Channel {
    id: string
    label: string
    icon: LucideIcon
}

/** Every plan connects the same channels; what differs is how many numbers. */
/**
 * Os canais que o plano promete mas o produto ainda não atende.
 *
 * A tela nunca diz "não configurado" para eles: não é falta de configurar, é
 * falta de existir — e um aviso desses manda a clínica procurar um botão que
 * não está lá. A mesma verdade aparece em `OUTROS_CANAIS`, na guia Canais do
 * agente, que lista estes dois como "em desenvolvimento".
 */
export const CANAIS_EM_DESENVOLVIMENTO = new Set(['whatsapp_api', 'instagram', 'facebook'])

export const PLAN_CHANNELS: Channel[] = [
    { id: 'whatsapp_qr', label: 'WhatsApp QR-Code', icon: QrCode },
    { id: 'whatsapp_api', label: 'WhatsApp API Oficial', icon: BadgeCheck },
    { id: 'instagram', label: 'Instagram', icon: Instagram },
    { id: 'facebook', label: 'Facebook', icon: Facebook },
]

export interface Plan {
    id: PlanId
    name: string
    description: string
    price: number
    badge?: string
    /** Vêm de `plan-limits.ts`, que é a fonte da verdade. */
    limits: PlanLimits
    /** Shown as the plan's bullet list, beneath the channel row. */
    features: string[]
}

export const PLANS: Record<PlanId, Plan> = {
    flow: {
        id: 'flow',
        name: 'Plano Essencial',
        description: 'Para a clínica que está começando a atender por WhatsApp',
        price: 490,
        limits: PLAN_LIMITS.flow,
        features: [
            '1 agente de atendimento IA',
            '1 número de WhatsApp',
            'CRM para clínicas com funil de vendas',
            'Usuários ilimitados',
        ],
    },
    pro: {
        id: 'pro',
        name: 'Plano Evolução',
        description: 'Para quem já tem volume e precisa dividir o atendimento',
        price: 690,
        badge: 'Mais escolhido',
        limits: PLAN_LIMITS.pro,
        features: [
            '2 agentes de atendimento IA',
            '4 números de WhatsApp',
            'CRM para clínicas com funil de vendas',
            'Usuários ilimitados',
        ],
    },
    advanced: {
        id: 'advanced',
        name: 'Plano Clínica 360',
        description: 'Para operações com várias unidades ou especialidades',
        price: 1290,
        limits: PLAN_LIMITS.advanced,
        features: [
            '3 agentes de atendimento IA',
            '6 números de WhatsApp',
            'CRM para clínicas com funil de vendas',
            'Usuários ilimitados',
        ],
    },
}

export const PLAN_LIST: Plan[] = [PLANS.flow, PLANS.pro, PLANS.advanced]

/**
 * Os pacotes de recarga de crédito.
 *
 * **Compra única**, não assinatura: o texto da tela dizia "R$ 49,90 por mês
 * enquanto estiver ativo" enquanto o banco guardava compra única com validade —
 * dois produtos diferentes na mesma tela, e quem comprasse leria um e receberia
 * o outro. Recarga que se repete todo mês é upgrade de plano com outro nome.
 *
 * **O preço por crédito é o mesmo que o plano entrega**, e isso é deliberado: na
 * conta do Andre, 10% da mensalidade é o orçamento de IA, e 10% de R$ 490 são os
 * R$ 49 que compram 10.000 créditos no Essencial. Logo não há arbitragem entre
 * comprar recarga e subir de plano — quem sobe de plano sobe por **estrutura**
 * (números, agentes), não por combustível. É o que mantém a escada de planos
 * honesta.
 *
 * **Três pacotes, não cinco.** Cinco opções espalham a decisão e quase todo o
 * volume cai nas duas primeiras. Cada um destes tem papel: o pico pequeno, o mês
 * de campanha, e a clínica que cresceu. O último também é sinal de que está na
 * hora de trocar de plano — R$ 184 de recarga contra os R$ 200 que separam
 * Essencial de Evolução, que vêm com três números a mais.
 *
 * A validade é a de `PURCHASE_VALIDITY_DAYS` (90 dias). Trinta foi considerado e
 * descartado: 50.000 créditos em 30 dias exigiriam 180 atendimentos por dia
 * contra os 20 de uma clínica de um agente — a clínica queimaria 90% do que
 * pagou, e isso não é desconto, é pegadinha.
 */
export interface CreditPack {
    credits: number
    price: number
    /** Desconto por crédito contra o pacote base, para a tela mostrar. */
    discount: number
    /** O papel do pacote, em uma linha, na voz de quem compra. */
    pitch: string
}

export const CREDIT_PACKS: CreditPack[] = [
    { credits: 10_000, price: 49, discount: 0, pitch: 'Para o mês que passou um pouco do normal.' },
    { credits: 30_000, price: 125, discount: 0.15, pitch: 'Para o mês de campanha, quando o movimento triplica.' },
    { credits: 50_000, price: 184, discount: 0.25, pitch: 'Para a clínica que cresceu e ainda não quer trocar de plano.' },
]

/** O pacote com exatamente esta quantidade, ou nada — a lista é fechada. */
export function creditPackFor(credits: unknown): CreditPack | undefined {
    return CREDIT_PACKS.find((pack) => pack.credits === credits)
}

export const TRIAL = {
    days: 7,
    credits: 1000,
    headline: 'Você tem 7 dias de avaliação gratuita',
    body: 'São 1.000 créditos de IA para validar o seu agente de atendimento. Não é necessário inserir o cartão de crédito agora, e nada é cobrado até você efetivar a assinatura.',
}

/** Price as "R$ 490,00". */
export function formatPrice(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value)
}


/** Falls back to the entry plan rather than throwing on unknown stored values. */
export function planFor(id: string | null | undefined): Plan {
    return id && id in PLANS ? PLANS[id as PlanId] : PLANS.flow
}
