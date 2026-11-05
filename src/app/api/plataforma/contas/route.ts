import { NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { getPlatformAdmin } from '@/lib/platform-credentials'

/**
 * As contas deste app, para o console da Venn360.
 *
 * Fechada em `getPlatformAdmin()` — OWNER do workspace marcado `isPlatform`.
 * Não é lista de permissão à parte: é o papel que já existe mais uma marca no
 * workspace, porque uma segunda lista de privilegiados é uma segunda coisa para
 * manter em dia, e ela sai de sincronia.
 *
 * **É por app.** O banco é por produto, então o console do OdontoBox vê as
 * clínicas do OdontoBox; o do Stagent, as agências dele. Não há visão
 * consolidada aqui, e não deve haver: ela exigiria um quarto sistema com acesso
 * de leitura aos três bancos.
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
                plano: c.subscription?.plan ?? null,
                situacao: c.subscription?.status ?? null,
                creditos: c.subscription?.credits ?? 0,
                creditosUsados: c.subscription?.creditsUsed ?? 0,
                avaliacaoAte: c.subscription?.trialEndsAt ?? null,
                somenteLeituraDesde: c.subscription?.readOnlySince ?? null,
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
