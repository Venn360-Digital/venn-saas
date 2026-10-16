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
