import prisma from '@/lib/prisma'
import { laneWhere } from '@/lib/deal-lanes'
import { readAutomations } from '@/lib/automations'
import { createLogger } from '../../logger'

const log = createLogger('CRON:FOLLOWUP')

/**
 * Quantos negócios uma varredura trata por fase.
 *
 * Teto para que a primeira execução numa clínica com funil antigo não crie
 * trezentas tarefas de uma vez — a recepção abriria a agenda e desistiria dela.
 * O que sobrar entra na varredura do dia seguinte.
 */
const MAX_PER_STAGE = 25

/**
 * A tarefa de retomada que nasce sozinha.
 *
 * Todo dia de manhã: negócio aberto, **sem nenhuma atividade pendente**, parado
 * na fase há mais dias do que aquela fase tolera, ganha uma tarefa de retomada
 * no nome do responsável, para hoje.
 *
 * Não duplica por construção. O filtro é o mesmo `no_activity` que a faixa de
 * prioridades usa na tela: assim que a tarefa existe, o negócio deixa de casar
 * com a consulta e a varredura de amanhã não o vê. Nenhuma lista de controle
 * paralela, nenhuma coluna de "já cobrei".
 *
 * Não envia nada ao paciente — isso é a camada de envio automático, que tem a
 * sua própria chave por fase. Aqui só se organiza a casa, e é por isso que esta
 * camada pode ficar ligada para todo mundo.
 */
export async function runFollowUp(): Promise<void> {
    const stages = await prisma.pipelineStage.findMany({
        where: { followUpDays: { not: null } },
        select: {
            id: true,
            name: true,
            workspaceId: true,
            followUpDays: true,
            workspace: { select: { automations: true } },
        },
    })

    if (stages.length === 0) {
        log.info('no stage asks for follow-up; nothing to do')
        return
    }

    const now = new Date()
    let created = 0

    /** Quem ganhou tarefa hoje, para receber um aviso só no fim. */
    const touched = new Map<string, { workspaceId: string; count: number }>()

    for (const stage of stages) {
        const days = stage.followUpDays ?? 0
        if (days <= 0) continue
        // A clínica pode desligar a camada inteira sem apagar os prazos das fases.
        if (!readAutomations(stage.workspace.automations).followUpTasks) continue

        const cutoff = new Date(now)
        cutoff.setDate(cutoff.getDate() - days)

        const candidates = await prisma.deal.findMany({
            where: {
                workspaceId: stage.workspaceId,
                stageId: stage.id,
                status: 'open',
                // "Sem próxima atividade", o mesmo predicado da faixa.
                ...laneWhere('no_activity', now),
                // Parado nesta fase além do que ela tolera. Sem histórico de
                // fase — negócios criados antes das entradas existirem — vale a
                // data de criação.
                AND: [
                    { stageEntries: { none: { enteredAt: { gte: cutoff } } } },
                    { OR: [{ stageEntries: { some: {} } }, { createdAt: { lt: cutoff } }] },
                ],
            },
            select: {
                id: true,
                title: true,
                userId: true,
                contactId: true,
                createdAt: true,
                contact: { select: { name: true, phone: true } },
                stageEntries: {
                    where: { stageId: stage.id },
                    orderBy: { enteredAt: { sort: 'desc', nulls: 'last' } },
                    take: 1,
                    select: { enteredAt: true },
                },
            },
            take: MAX_PER_STAGE,
        })

        for (const deal of candidates) {
            const since = deal.stageEntries[0]?.enteredAt ?? deal.createdAt
            const idle = Math.floor((now.getTime() - since.getTime()) / 86_400_000)
            const who = deal.contact?.name || deal.contact?.phone || 'paciente'

            await prisma.activity.create({
                data: {
                    workspaceId: stage.workspaceId,
                    // Fica com o responsável pelo negócio. Sem responsável, a
                    // tarefa existe sem dono e aparece para a equipe: melhor
                    // órfã e visível do que não existir.
                    userId: deal.userId,
                    contactId: deal.contactId,
                    dealId: deal.id,
                    type: 'followup',
                    auto: true,
                    title: `Retomar contato — ${who}`,
                    description:
                        `${idle} dias em "${stage.name}" sem nenhum retorno marcado. ` +
                        'Tarefa criada automaticamente pelo follow-up.',
                    dueDate: now,
                },
            })
            created += 1

            if (deal.userId) {
                const entry = touched.get(deal.userId) ?? { workspaceId: stage.workspaceId, count: 0 }
                entry.count += 1
                touched.set(deal.userId, entry)
            }
        }

        if (candidates.length === MAX_PER_STAGE) {
            log.warn(`stage ${stage.name} hit the ${MAX_PER_STAGE} cap; the rest comes tomorrow`)
        }
    }

    // Um aviso por pessoa, não um por tarefa: cinco retomadas são uma notícia,
    // não cinco.
    for (const [userId, { workspaceId, count }] of touched) {
        await prisma.notification.create({
            data: {
                workspaceId,
                userId,
                kind: 'follow_up',
                title: count === 1 ? '1 retomada para hoje' : `${count} retomadas para hoje`,
                body: 'Pacientes parados sem nenhum retorno marcado.',
                link: '/vendas/agenda',
            },
        })
    }

    log.info(`created ${created} follow-up task(s) across ${stages.length} stage(s)`)
}
