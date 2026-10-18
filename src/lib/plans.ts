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
import { InstagramIcon, WhatsAppIcon } from '@/components/shared/BrandIcons'
import { Globe } from 'lucide-react'

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
 * não está lá.
 *
 * Sobrou **só o Facebook**. O WhatsApp oficial saiu quando ganhou botão, em
 * 2026-10-16, e o Instagram saiu quando ganhou o dele — a partir daí o certo é
 * dizer "não configurado", porque há exatamente onde clicar. Deixá-los aqui
 * faria o painel anunciar como futuro um canal que a clínica pode ligar agora.
 */
export const CANAIS_EM_DESENVOLVIMENTO = new Set(['facebook'])

export const PLAN_CHANNELS: Channel[] = [
    { id: 'whatsapp_qr', label: 'WhatsApp QR-Code', icon: QrCode },
    { id: 'whatsapp_api', label: 'WhatsApp API Oficial', icon: BadgeCheck },
    { id: 'instagram', label: 'Instagram', icon: Instagram },
    { id: 'facebook', label: 'Facebook', icon: Facebook },
]

export interface PlanFeature {
    text: string
    /** Em negrito no cartão. Para o item que vende o plano. */
    strong?: boolean
}

/**
 * As redes que o cartão de plano anuncia — lista **comercial**, não operacional.
 *
 * Separada de `PLAN_CHANNELS` porque as duas respondem perguntas diferentes.
 * `PLAN_CHANNELS` é técnica: tem `whatsapp_qr` e `whatsapp_business` separados,
 * e o painel precisa disso, porque são duas integrações com status
 * independentes. O cartão de plano responde "com quais redes eu falo com o
 * paciente", e para essa pergunta as duas formas de conectar o WhatsApp são **o
 * WhatsApp** — foi por isso que um QR Code e um selo de verificação na fileira
 * de ícones não quiseram dizer nada para ninguém.
 */
export interface RedeDoPlano {
    id: string
    label: string
    /**
     * Aceita tanto os glifos de marca daqui quanto um ícone do Lucide — o do
     * site não é marca nenhuma, é um globo.
     */
    icon: React.ComponentType<{ className?: string }>
    /**
     * Marca no canto do ícone, para distinguir duas conexões da mesma rede.
     *
     * Só o WhatsApp tem: a mesma rede entra por leitura de QR Code ou pela API
     * oficial da Meta, e são produtos diferentes para a clínica — a oficial não
     * depende de um celular ligado. Sem a marca, seriam dois ícones idênticos
     * lado a lado, que é pior que não mostrar.
     */
    marca?: string
    /** O produto ainda não atende. O cartão não pode prometer o que não existe. */
    emBreve?: boolean
    /**
     * Em quais planos esta conexão entra. Ausente: em todos.
     *
     * O agente no site é item do Prime para cima, e sem este recorte o cartão do
     * Digital mostraria o ícone do site na fileira enquanto a lista de itens
     * logo abaixo não o traz — a mesma tela dizendo duas coisas.
     */
    planos?: PlanId[]
}

/**
 * **O Messenger saiu em 2026-10-16**, por decisão do Andre: o caso de uso foi
 * retirado do aplicativo na Meta porque acrescentava cinco permissões à revisão,
 * cada uma com o seu próprio vídeo, e exigia publicar uma página do Facebook. DM
 * de Facebook não é argumento de venda para clínica odontológica.
 *
 * Com todos os ícones na mesma cor — pedido dele, e a fileira melhorou —, não há
 * nada que distinga "existe" de "vai existir". Deixá-lo aqui seria prometer o
 * que ninguém está construindo. O glifo continua em `BrandIcons` para quando
 * voltar.
 */
export const REDES_DO_PLANO: RedeDoPlano[] = [
    { id: 'site', label: 'Site da clínica', icon: Globe, planos: ['pro', 'advanced'] },
    { id: 'whatsapp', label: 'WhatsApp', icon: WhatsAppIcon },
    { id: 'whatsapp_api', label: 'WhatsApp API Oficial', icon: WhatsAppIcon, marca: 'API', emBreve: true },
    { id: 'instagram', label: 'Instagram Direct', icon: InstagramIcon, emBreve: true },
]

/** As conexões que este plano anuncia, na ordem da fileira. */
export function redesDoPlano(planId: PlanId): RedeDoPlano[] {
    return REDES_DO_PLANO.filter((rede) => !rede.planos || rede.planos.includes(planId))
}

export interface Plan {
    id: PlanId
    /**
     * O ícone do plano, em `public/planos`.
     *
     * Eram glifos genéricos do Lucide — raio, estrela e coroa —, que não diziam
     * nada sobre o produto e não eram da marca. Estes são desenhados para o
     * sistema: um, dois e três balões de conversa, com o degradê do ciano da
     * marca. A contagem de balões é o degrau do plano, e conversa é o que o
     * produto faz.
     *
     * **São dois jogos, um por tema.** O degradê rico da marca, ciano para
     * marinho, fica lindo no cartão branco e some no cartão do tema escuro, que
     * é marinho (#0e2440): os balões escuros desapareciam dentro do fundo, o
     * Prime virava um balão só e o Multiclínica perdia a estrutura. Medido
     * compondo os ícones sobre os dois fundos antes de instalar.
     *
     * O jogo escuro é o **mesmo desenho recolorido**, não um desenho novo —
     * gerado por edição a partir do arquivo claro. Um segundo desenho mudaria a
     * geometria ao trocar de tema, e forma que muda sozinha lê como defeito, não
     * como tema.
     */
    icon: string
    /** O mesmo desenho, em degradê luminoso, para o cartão do tema escuro. */
    iconDark: string
    name: string
    description: string
    price: number
    badge?: string
    /** Vêm de `plan-limits.ts`, que é a fonte da verdade. */
    limits: PlanLimits
    /**
     * A lista de itens do cartão, embaixo da fileira de canais.
     *
     * Objeto e não texto puro porque um item precisa de destaque — o Diagnóstico
     * de LGPD, no Multiclínica. Marcador dentro da string exigiria um
     * interpretador nos dois lugares que desenham o cartão.
     */
    features: PlanFeature[]
}

export const PLANS: Record<PlanId, Plan> = {
    flow: {
        id: 'flow',
        icon: '/planos/digital.png',
        iconDark: '/planos/digital-escuro.png',
        name: 'Plano Digital',
        description:
            'Para clínicas que precisam conectar pacientes, WhatsApp e atendimento em um só lugar.',
        price: 390,
        limits: PLAN_LIMITS.flow,
        features: [
            { text: '1 agente de atendimento IA' },
            { text: '1 número de WhatsApp' },
            { text: '1 unidade (clínica)' },
            { text: 'CRM para clínicas com funil de vendas' },
            { text: 'Usuários ilimitados' },
            { text: 'Dashboard inteligente' },
            { text: 'Agenda integrada com Google Calendar' },
            { text: '10.000 créditos de IA por mês' },
        ],
    },
    pro: {
        id: 'pro',
        icon: '/planos/prime.png',
        iconDark: '/planos/prime-escuro.png',
        name: 'Plano Prime',
        description:
            'Para clínicas que precisam distribuir conversas, ampliar o atendimento e administrar mais canais.',
        price: 590,
        badge: 'Mais escolhido',
        limits: PLAN_LIMITS.pro,
        features: [
            { text: '2 agentes de atendimento IA' },
            { text: '4 números de WhatsApp' },
            { text: '1 unidade (clínica)' },
            { text: 'CRM para clínicas com funil de vendas' },
            { text: 'Usuários ilimitados' },
            { text: 'Dashboard inteligente' },
            { text: 'Agente de IA no site da clínica' },
            { text: 'Agenda integrada com Google Calendar' },
            { text: 'Integração com CliniCorp' },
            { text: '20.000 créditos de IA por mês' },
        ],
    },
    advanced: {
        id: 'advanced',
        icon: '/planos/multiclinica.png',
        iconDark: '/planos/multiclinica-escuro.png',
        name: 'Plano Multiclínica',
        description:
            'Para clínicas com operações maiores, múltiplas unidades e maior fluxo de pacientes.',
        price: 890,
        limits: PLAN_LIMITS.advanced,
        features: [
            { text: '3 agentes de atendimento IA' },
            { text: '6 números de WhatsApp' },
            { text: '3 unidades (clínicas)' },
            { text: 'CRM para clínicas com funil de vendas' },
            { text: 'Usuários ilimitados' },
            { text: 'Dashboard inteligente' },
            { text: 'Agente de IA no site da clínica' },
            { text: 'Agenda integrada com Google Calendar' },
            { text: 'Integração com CliniCorp' },
            { text: 'Diagnóstico de LGPD (proteção de dados)', strong: true },
            { text: '30.000 créditos de IA por mês' },
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

/**
 * A unidade adicional, vendida fora do plano.
 *
 * **Qualquer plano, a qualquer momento** — não é privilégio do Multiclínica. O
 * preço não é arbitrário: o Multiclínica são R$ 890 por três unidades, ou seja
 * R$ 297 cada, e o adicional só torna explícito o preço marginal que o plano já
 * embute. Fica abaixo dos R$ 390 de um Digital avulso, que é a alternativa que o
 * cliente tem hoje, e com ele a clínica mantém uma fatura, uma renovação e a
 * troca de unidade pela própria tela.
 *
 * **Não traz capacidade.** Nenhum agente, nenhum número, nenhum crédito: compra
 * separação — CRM, agenda e conversas próprios da outra clínica. É o que
 * mantém a escada de planos honesta, do mesmo jeito que a recarga de crédito
 * custa por crédito o que o plano entrega: se a unidade trouxesse um agente,
 * comprar unidade ficaria mais barato que subir de plano (Digital → Prime são
 * R$ 200 por +1 agente, +3 números e +10.000 créditos) e a escada inverteria.
 *
 * A consequência é de venda, não técnica, e está em PRODUCT.md §12: um Digital
 * com duas unidades tem **um** agente e **um** número para as duas.
 */
export const UNIDADE_ADICIONAL = {
    price: 290,
    name: 'Unidade adicional',
    pitch: 'Mais uma clínica na mesma conta, com pacientes, agenda e conversas próprios.',
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
