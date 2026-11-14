import { NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { getPlatformAdmin } from '@venn/core/lib/platform-credentials'
import { planNameFor } from '@venn/core/lib/plan-limits'

/**
 * As contas deste app, para o console da Venn360.
 *
 * Fechada em `getPlatformAdmin()` — OWNER do workspace marcado `isPlatform`.
 * Não é lista de permissão à parte: é o papel que já existe mais uma marca no
 * workspace, porque uma segunda lista de privilegiados é uma segunda coisa para
 * manter em dia, e ela sai de sincronia.
 *
 * **É por app.** O banco é por produto, então este console vê as contas deste
 * produto e de nenhum outro. Não há visão consolidada aqui, e não deve haver:
 * ela exigiria um sistema à parte com acesso de leitura a todos os bancos.
 */
export async function GET() {
    const admin = await getPlatformAdmin()
    if (!admin) {
        return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
    }

    const contas = await prisma.account.findMany({
        select: {
            id: true,
            name: true,
            createdAt: true,
            owner: { select: { email: true } },
            subscription: {
                select: {
                    plan: true,
                    status: true,
                    credits: true,
                    creditsUsed: true,
                    trialEndsAt: true,
                    readOnlySince: true,
                    graceEndsAt: true,
                },
            },
            workspaces: {
                where: { suspendedAt: null },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    name: true,
                    isPlatform: true,
                    /**
                     * A última atividade de alguém da unidade é a melhor pista
                     * de "esta conta está viva" que existe sem instrumentar
                     * nada. Uma clínica que não abre o sistema há dois dias é
                     * uma clínica para ligar.
                     */
                    users: {
                        orderBy: { ultimaAtividadeEm: 'desc' },
                        take: 1,
                        select: { ultimaAtividadeEm: true },
                    },
                    _count: { select: { users: true } },
                },
            },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
    })

    /**
     * "Somente leitura" é uma **comparação de data**, não a existência do campo.
     *
     * `readOnlySince` guarda *desde quando* a conta está cortada, e o produto a
     * lê assim (`lib/billing.ts`): cortada é `readOnlySince <= agora`. Uma data
     * futura é um corte **agendado** — a conta está operando até lá.
     *
     * O console checava só se o campo existia, e por isso acendia o aviso numa
     * conta que o sistema tratava como ativa. É o defeito que o DESIGN.md
     * adverte em toda tela que mostra estado derivado: a tela tem de usar a
     * mesma regra que o sistema usa, senão as duas divergem e a tela é a que
     * mente.
     */
    const agora = Date.now()

    return NextResponse.json({
        contas: contas.map((c) => {
            const unidades = c.workspaces
            const ultima = unidades
                .map((w) => w.users[0]?.ultimaAtividadeEm ?? null)
                .filter((d): d is Date => d !== null)
                .sort((a, b) => b.getTime() - a.getTime())[0]

            return {
                id: c.id,
                nome: c.name,
                email: c.owner?.email ?? null,
                criadaEm: c.createdAt,
                /**
                 * O nome comercial, não o slug.
                 *
                 * O mesmo `pro` é "Plano Prime" num app e "Plano Growth" no
                 * outro — `planNameFor` é quem sabe disso, e é a mesma função
                 * que a tela de Assinatura do cliente usa. O console mostrava
                 * `pro` cru, que não é o nome de nada para quem lê.
                 */
                plano: c.subscription ? planNameFor(c.subscription.plan) : null,
                situacao: c.subscription?.status ?? null,
                creditos: c.subscription?.credits ?? 0,
                creditosUsados: c.subscription?.creditsUsed ?? 0,
                avaliacaoAte: c.subscription?.trialEndsAt ?? null,
                /** A data crua, para a tela poder dizer "corta em 13/11". */
                somenteLeituraDesde: c.subscription?.readOnlySince ?? null,
                /** Já cortada **agora** — a mesma conta que `lib/billing.ts` faz. */
                cortada: Boolean(
                    c.subscription?.readOnlySince &&
                        c.subscription.readOnlySince.getTime() <= agora
                ),
                carenciaAte: c.subscription?.graceEndsAt ?? null,
                ultimaAtividadeEm: ultima ?? null,
                /** A conta da própria Venn360 não se assume — já é a de casa. */
                daPlataforma: unidades.some((w) => w.isPlatform),
                unidades: unidades.map((w) => ({
                    id: w.id,
                    nome: w.name,
                    pessoas: w._count.users,
                })),
            }
        }),
    })
}
