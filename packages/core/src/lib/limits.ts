import { Prisma } from '@venn/db'
import prisma from '@venn/db/cliente'
import { accountIdOf, assinaturaDaUnidade, unidadesDaConta, type Unidades } from './account'
import type { CanalDeCampanha } from './marketing/apresentacao'
import { limitesEfetivos, planNameFor } from './plan-limits'

/**
 * What the workspace's plan actually allows, and how much of it is used.
 *
 * The plan chosen at onboarding used to be cosmetic: it was displayed and never
 * enforced, so a clinic on the entry plan could create as many agents and
 * connect as many numbers as it liked. These are the numbers the API checks
 * before creating either.
 */
export interface WorkspaceLimits {
    planId: string | null
    planName: string | null
    status: string
    agents: { used: number; max: number; remaining: number; pausedByLimit: number }
    whatsapp: { used: number; max: number; remaining: number }
    credits: { used: number; total: number; remaining: number }
    /**
     * As unidades da conta: quantas tem, quantas pode ter.
     *
     * Vem junto porque quem pergunta "o que meu plano me dá" pergunta as quatro
     * coisas de uma vez — agentes, números, crédito e unidades —, e a tela de
     * plano desenha as quatro na mesma faixa.
     */
    units: Unidades
    trialEndsAt: Date | null
    /** True while the workspace has no subscription row at all. */
    unsubscribed: boolean
}

/**
 * Quando uma linha de WhatsApp ocupa uma vaga do plano.
 *
 * Antes era "existe uma linha": qualquer registro contava, inclusive um que
 * nunca pareou. Com um número por agente isso quase não aparecia — o registro
 * era a vaga do agente. Com N linhas por agente virou armadilha: adicionar uma
 * linha, errar o QR e desistir queimava uma vaga do plano para sempre.
 *
 * Ocupa vaga a linha que está no ar, a que está pareando agora, e a que já
 * pareou alguma vez e hoje está fora do ar — essa última continua sendo um
 * número da clínica, à espera de reconectar. A que nunca pareou não ocupa
 * nada, e pode ser removida da tela para não poluir a lista.
 */
const HOLDS_A_SLOT: Prisma.AgentIntegrationWhereInput = {
    channel: { in: ['whatsapp_qr', 'whatsapp_business'] },
    OR: [{ status: { not: 'disconnected' } }, { phoneNumber: { not: null } }],
}

/**
 * A franquia é da **conta**, e por isso a contagem atravessa as unidades.
 *
 * Isto contava `where: { workspaceId }` enquanto a assinatura já era da conta,
 * e a aritmética não fechava: a segunda unidade ganharia a franquia inteira de
 * novo, e um Multiclínica com três unidades chegaria a nove agentes e dezoito
 * números. Ficava invisível só porque toda conta tinha uma unidade.
 *
 * A assinatura some para quem chama: o parâmetro continua sendo a unidade, que
 * é o que as nove chamadas têm em mãos. A tradução para conta acontece aqui,
 * como em `assinaturaDaUnidade`.
 */
export async function getWorkspaceLimits(workspaceId: string): Promise<WorkspaceLimits> {
    const accountId = await accountIdOf(workspaceId)
    /** Todas as unidades de quem paga — ou só esta, se a conta sumiu. */
    const daConta: Prisma.AgentWhereInput = accountId
        ? { workspace: { accountId } }
        : { workspaceId }

    const [subscription, agentCount, agentesPausados, whatsappCount, units] = await Promise.all([
        prisma.subscription.findFirst({ where: assinaturaDaUnidade(workspaceId) }),
        /**
         * Todos, **inclusive os pausados pelo limite**.
         *
         * Pausado não é apagado: o agente guarda prompt, histórico e integrações,
         * e volta inteiro quando o plano cresce. Se ele não ocupasse vaga,
         * descer de plano pausaria um e logo em seguida liberaria a criação de
         * outro — de volta acima do teto, pausando de novo, sem fim.
         */
        prisma.agent.count({ where: daConta }),
        prisma.agent.count({ where: { ...daConta, pausedByLimit: true } }),
        // Linhas que ocupam vaga, em todos os agentes de todas as unidades da
        // conta — o teto é de quem paga. Ver `HOLDS_A_SLOT`.
        prisma.agentIntegration.count({
            where: { agent: daConta, ...HOLDS_A_SLOT },
        }),
        accountId
            ? unidadesDaConta(accountId)
            : Promise.resolve({
                  used: 0,
                  max: 0,
                  remaining: 0,
                  doPlano: 0,
                  adicionais: 0,
                  cancelados: 0,
                  cobraveis: 0,
                  maxDepois: 0,
                  livres: 0,
              }),
    ])

    if (!subscription) {
        return {
            planId: null,
            planName: null,
            status: 'none',
            agents: { used: agentCount, max: 0, remaining: 0, pausedByLimit: agentesPausados },
            whatsapp: { used: whatsappCount, max: 0, remaining: 0 },
            credits: { used: 0, total: 0, remaining: 0 },
            units,
            trialEndsAt: null,
            unsubscribed: true,
        }
    }

    /**
     * O teto vem da **tabela viva**, não da cópia na assinatura.
     *
     * A assinatura guarda uma cópia escrita na contratação, e ela envelhece: um
     * adicional comprado depois não aparece lá até alguém reaplicar o plano. Com
     * os adicionais trazendo agente e número desde 2026-10-19, essa defasagem
     * seria a clínica pagando por um agente que o sistema recusa criar.
     *
     * `Math.max` com a cópia preserva o caso oposto — assinatura com teto maior
     * que a tabela, concedido à mão —, que é o mesmo cuidado que o cron de
     * renovação já toma.
     */
    const efetivos = limitesEfetivos(subscription.plan, units.adicionais)
    const maxAgents = Math.max(subscription.maxAgents, efetivos.maxAgents)
    const maxWhatsApp = Math.max(subscription.maxWhatsAppNumbers, efetivos.maxWhatsAppNumbers)

    return {
        planId: subscription.plan,
        planName: planNameFor(subscription.plan),
        status: subscription.status,
        agents: {
            used: agentCount,
            max: maxAgents,
            remaining: Math.max(0, maxAgents - agentCount),
            pausedByLimit: agentesPausados,
        },
        whatsapp: {
            used: whatsappCount,
            max: maxWhatsApp,
            remaining: Math.max(0, maxWhatsApp - whatsappCount),
        },
        credits: {
            used: subscription.creditsUsed,
            total: subscription.credits,
            remaining: Math.max(0, subscription.credits - subscription.creditsUsed),
        },
        units,
        trialEndsAt: subscription.trialEndsAt,
        unsubscribed: false,
    }
}

/**
 * "nas suas N unidades", quando são mais de uma.
 *
 * Sem isto a recusa fica incompreensível justamente para quem tem multiunidade:
 * a tela diz "você já tem 3 agentes" numa unidade onde há um, porque os outros
 * dois estão na clínica do outro bairro. A frase é o que liga o número ao lugar.
 */
function emTodasAsUnidades(units: Unidades): string {
    return units.used > 1 ? ` nas suas ${units.used} unidades` : ''
}

/**
 * "(1 deles pausado por exceder o plano)", quando é o caso.
 *
 * Sem esta frase a recusa não fecha a conta para quem olha a tela: ela diz
 * "você já tem 3 agentes" numa clínica onde um está visivelmente desligado, e a
 * pessoa conclui que o sistema contou errado. Contou certo — pausado ocupa vaga,
 * porque não foi apagado —, e é a frase que explica.
 */
function dosQuaisPausados(pausados: number): string {
    if (pausados <= 0) return ''
    return pausados === 1
        ? ' (1 deles pausado por exceder o plano)'
        : ` (${pausados} deles pausados por exceder o plano)`
}

export interface LimitRefusal {
    ok: false
    status: number
    error: string
}

export type LimitCheck = { ok: true } | LimitRefusal

/**
 * Messages name the plan and the number, because "limite atingido" alone leaves
 * the user with no idea what to do next.
 */
export async function canCreateAgent(workspaceId: string): Promise<LimitCheck> {
    const limits = await getWorkspaceLimits(workspaceId)

    if (limits.unsubscribed) {
        return {
            ok: false,
            status: 402,
            error: 'Este workspace ainda não tem um plano. Escolha um em Gerenciamento → Conta.',
        }
    }
    if (limits.agents.remaining <= 0) {
        return {
            ok: false,
            status: 402,
            error: `O ${limits.planName} inclui ${limits.agents.max} agente${limits.agents.max === 1 ? '' : 's'} de IA, e você já tem ${limits.agents.used}${emTodasAsUnidades(limits.units)}${dosQuaisPausados(limits.agents.pausedByLimit)}. Mude de plano em Gerenciamento → Conta para criar mais.`,
        }
    }
    return { ok: true }
}

export async function canConnectWhatsApp(
    workspaceId: string,
    /**
     * A linha sendo reconectada, quando é uma.
     *
     * Reconectar uma linha que já existe não consome vaga nova — ela já conta.
     * Recusar aqui trancaria do lado de fora justamente a clínica que está no
     * teto do plano e só quer sua própria sessão de volta.
     *
     * Antes este parâmetro era o **agente**, e a isenção valia para qualquer
     * linha que ele tivesse: com N linhas por agente, isso liberaria números
     * sem limite para quem já tivesse um.
     */
    integrationId?: string
): Promise<LimitCheck> {
    if (integrationId) {
        const existing = await prisma.agentIntegration.findFirst({
            where: { id: integrationId, agent: { workspaceId } },
            select: { id: true },
        })
        if (existing) return { ok: true }
    }

    const limits = await getWorkspaceLimits(workspaceId)

    if (limits.unsubscribed) {
        return {
            ok: false,
            status: 402,
            error: 'Este workspace ainda não tem um plano. Escolha um em Gerenciamento → Conta.',
        }
    }
    if (limits.whatsapp.remaining <= 0) {
        return {
            ok: false,
            status: 402,
            error: `O ${limits.planName} inclui ${limits.whatsapp.max} número${limits.whatsapp.max === 1 ? '' : 's'} de WhatsApp, e você já conectou ${limits.whatsapp.used}${emTodasAsUnidades(limits.units)}. Mude de plano em Gerenciamento → Conta para conectar mais.`,
        }
    }
    return { ok: true }
}

/**
 * Pode disparar uma campanha para `recipientCount` destinatários este mês?
 *
 * O teto é da conta e por mês, igual à franquia de mensagem — e separado dela
 * de propósito (ver `PlanLimits.maxBroadcastRecipientsPerMonth`): um disparo não
 * pode comer a cota de conversa do dia a dia. Conta os destinatários que já
 * saíram (sent/delivered/read) ou falharam no envio neste mês, em todas as
 * unidades da conta, e recusa se somar acima do teto. `skipped`/`pending` não
 * contam: ninguém foi disparado.
 *
 * **Um teto por canal.** WhatsApp e e-mail têm baldes próprios porque custam
 * ordens de grandeza diferentes — ver `PlanLimits.maxEmailsPerMonth`.
 */
export async function canBroadcast(
    workspaceId: string,
    recipientCount: number,
    canal: CanalDeCampanha = 'whatsapp'
): Promise<LimitCheck> {
    const limits = await getWorkspaceLimits(workspaceId)

    if (limits.unsubscribed) {
        return {
            ok: false,
            status: 402,
            error: 'Este workspace ainda não tem um plano. Escolha um em Gerenciamento → Conta.',
        }
    }

    const efetivos = limitesEfetivos(limits.planId, limits.units.adicionais)

    /**
     * Cada canal tem o próprio teto, e a razão é o custo.
     *
     * Uma mensagem de marketing no WhatsApp custa R$ 0,3217 (Meta, Brasil); um
     * e-mail, cerca de R$ 0,0009. Um teto só teria de ser calibrado pelo canal
     * caro, e o barato ficaria artificialmente apertado sem nenhum ganho.
     */
    const porEmail = canal === 'email'
    const allowance = porEmail
        ? efetivos.maxEmailsPerMonth
        : efetivos.maxBroadcastRecipientsPerMonth

    if (allowance <= 0) {
        return {
            ok: false,
            status: 402,
            error: porEmail
                ? `O ${limits.planName} não inclui campanha de e-mail. Mude de plano em Gerenciamento → Conta.`
                : `O ${limits.planName} não inclui disparo de campanhas. Mude de plano em Gerenciamento → Conta.`,
        }
    }

    const accountId = await accountIdOf(workspaceId)
    const daConta: Prisma.BroadcastWhereInput = accountId
        ? { workspace: { accountId } }
        : { workspaceId }

    const inicioDoMes = new Date()
    inicioDoMes.setDate(1)
    inicioDoMes.setHours(0, 0, 0, 0)

    const usados = await prisma.broadcastRecipient.count({
        where: {
            // O recorte do canal entra no `broadcast`, não no destinatário: é
            // a campanha que tem canal. Sem ele, um mês cheio de e-mail
            // bloquearia o disparo de WhatsApp, e vice-versa — que é
            // exatamente o que dois tetos existem para evitar.
            broadcast: { ...daConta, channel: canal },
            status: { in: ['sent', 'delivered', 'read', 'failed'] },
            createdAt: { gte: inicioDoMes },
        },
    })

    if (usados + recipientCount > allowance) {
        return {
            ok: false,
            status: 402,
            error: `O ${limits.planName} inclui ${allowance.toLocaleString('pt-BR')} ${porEmail ? 'e-mails de campanha' : 'destinatários de campanha'} por mês, e você já usou ${usados.toLocaleString('pt-BR')}. Reduza a lista ou mude de plano em Gerenciamento → Conta.`,
        }
    }

    return { ok: true }
}

/**
 * Brings the account in line with the plan's allowance after a plan change.
 *
 * Downgrading pauses the excess by reverse order of creation — the oldest agent
 * survives, because it is the one most likely to be the clinic's real one.
 * Nothing is deleted: a paused agent keeps its prompt, its history and its
 * integrations, and comes back whole when the plan grows again.
 *
 * `pausedByLimit` is what makes the pause stick. A plain `isActive: false` could
 * be switched back on from the agents screen, which would put the workspace over
 * its plan with no further check. Only this function clears it.
 *
 * **Atravessa as unidades da conta**, como a contagem que a autoriza. Fazer o
 * ajuste só na unidade onde o plano foi trocado deixaria a conta acima do plano
 * pelo caminho mais simples que existe: descer de plano numa unidade e manter os
 * agentes da outra. O mais antigo que sobrevive é o mais antigo **da conta** —
 * que é também o mais provável de ser a clínica original.
 */
export async function applyPlanLimits(
    workspaceId: string,
    limits: { maxAgents: number; maxWhatsAppNumbers: number }
): Promise<{ agentsPaused: number; agentsReleased: number; numbersPaused: number }> {
    const accountId = await accountIdOf(workspaceId)
    /** Todas as unidades de quem paga — ou só esta, se a conta sumiu. */
    const daConta: Prisma.AgentWhereInput = accountId
        ? { workspace: { accountId } }
        : { workspaceId }

    const agents = await prisma.agent.findMany({
        where: daConta,
        orderBy: { createdAt: 'asc' },
        select: { id: true, pausedByLimit: true },
    })

    const keep = agents.slice(0, limits.maxAgents)
    const excess = agents.slice(limits.maxAgents)

    // Release first: an upgrade should restore what a previous downgrade took,
    // and only the agents that this rule paused — one the user switched off by
    // hand stays off.
    const toRelease = keep.filter((a) => a.pausedByLimit).map((a) => a.id)
    if (toRelease.length > 0) {
        await prisma.agent.updateMany({
            where: { id: { in: toRelease } },
            data: { pausedByLimit: false, isActive: true },
        })
    }

    const toPause = excess.filter((a) => !a.pausedByLimit).map((a) => a.id)
    if (toPause.length > 0) {
        await prisma.agent.updateMany({
            where: { id: { in: toPause } },
            data: { pausedByLimit: true, isActive: false },
        })
    }

    // The same rule for connected numbers. Disconnecting is a status change, not
    // a deletion — the instance and its history stay, so reconnecting does not
    // start from zero.
    const integrations = await prisma.agentIntegration.findMany({
        where: { agent: daConta, ...HOLDS_A_SLOT },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    })
    const excessNumbers = integrations.slice(limits.maxWhatsAppNumbers).map((i) => i.id)
    if (excessNumbers.length > 0) {
        await prisma.agentIntegration.updateMany({
            where: { id: { in: excessNumbers } },
            data: { status: 'disconnected', errorMessage: 'Acima do limite do plano' },
        })
    }

    return {
        agentsPaused: toPause.length,
        agentsReleased: toRelease.length,
        numbersPaused: excessNumbers.length,
    }
}
