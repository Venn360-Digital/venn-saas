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
    /** Written onto the subscription and enforced server-side. */
    limits: {
        maxAgents: number
        maxWhatsAppNumbers: number
        /**
         * Franquia mensal de crédito, uma vez que a assinatura esteja ativa.
         *
         * **Um crédito é uma resposta do agente**, e isso não vai para a tabela
         * comercial: publicar a conversão convida o cliente a dividir a
         * mensalidade por ela e chegar a cinco centavos. Dito a quem perguntar,
         * nunca na vitrine. O que a tela mostra é percentual.
         *
         * Dimensionada em ~1,8x o uso provável (20/40/60 atendimentos por dia ×
         * 30 dias × 9,25 respostas), o que põe o cliente típico em 56% da
         * franquia: nem tão vazio que ele se sinta pagando por nada, nem tão
         * cheio que se sinta ameaçado todo mês.
         */
        credits: number
        maxMessages: number
        /**
         * Quantas respostas o agente pode **falar** no mês.
         *
         * Teto, e não peso no crédito. A fala custa cerca de dez vezes o texto,
         * e já foi tentado cobrar 2 créditos por resposta falada: com crédito
         * abstrato, peso variável deixa a carteira imprevisível — o cliente não
         * entende por que caiu 2 em vez de 1. O teto mantém o crédito uniforme e
         * protege a margem igual, porque é ele que fecha o pior caso dentro dos
         * 10% da mensalidade que o Andre destinou a custo de IA.
         */
        maxSpokenReplies: number
    }
    /** Shown as the plan's bullet list, beneath the channel row. */
    features: string[]
}

export type PlanId = 'flow' | 'pro' | 'advanced'

export const PLANS: Record<PlanId, Plan> = {
    flow: {
        id: 'flow',
        name: 'Plano Essencial',
        description: 'Para a clínica que está começando a atender por WhatsApp',
        price: 490,
        limits: {
            maxAgents: 1,
            maxWhatsAppNumbers: 1,
            credits: 10000,
            maxMessages: 10000,
            maxSpokenReplies: 400,
        },
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
        limits: {
            maxAgents: 2,
            maxWhatsAppNumbers: 4,
            credits: 20000,
            maxMessages: 20000,
            maxSpokenReplies: 750,
        },
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
        limits: {
            maxAgents: 3,
            maxWhatsAppNumbers: 6,
            credits: 30000,
            maxMessages: 30000,
            maxSpokenReplies: 1500,
        },
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

export function isPlanId(value: unknown): value is PlanId {
    return typeof value === 'string' && value in PLANS
}

/** Falls back to the entry plan rather than throwing on unknown stored values. */
export function planFor(id: string | null | undefined): Plan {
    return isPlanId(id) ? PLANS[id] : PLANS.flow
}
