import prisma from '@/lib/prisma'
import { transmitir } from '@/trabalhos/tempo-real'
import { createLogger } from '@/trabalhos/registro'
import { diaDeDataSemHora, instanteNoFuso } from '@/lib/fuso'

const log = createLogger('CRON:REMINDERS')

/**
 * Push due activity reminders to connected operators over the realtime channel.
 *
 * Complements — does not replace — the `/api/activities/reminders` poll the
 * Topbar already runs. This job deliberately leaves `reminderSentAt` untouched:
 * marking it here would hide the reminder from that endpoint, so an operator who
 * was not connected at this exact minute would never see it at all.
 *
 * Known limitation: delivery is still only to browsers currently open. Durable
 * delivery (so a reminder survives the operator being offline, or reaches them by
 * e-mail/WhatsApp) needs a `Notification` table, which does not exist yet.
 */
export async function runActivityReminders(): Promise<void> {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const candidates = await prisma.activity.findMany({
        where: {
            reminderMinutes: { not: null },
            completedAt: null,
            reminderSentAt: null,
            dueDate: { gte: yesterday },
            userId: { not: null },
        },
        include: {
            contact: { select: { id: true, name: true } },
            deal: { select: { id: true, title: true } },
        },
        orderBy: { dueDate: 'asc' },
    })

    const due = candidates.filter((activity) => {
        if (!activity.dueDate || !activity.reminderMinutes) return false

        // dueDate carries the day and startTime the clock, so they have to be
        // recombined to decide whether the reminder window has opened.
        // A hora combinada é de parede, da clínica: `setHours` a marcava em
        // UTC no Worker, e o lembrete saía três horas adiantado.
        const dueAt = instanteNoFuso(
            diaDeDataSemHora(new Date(activity.dueDate)),
            activity.startTime || '09:00'
        )

        const fireAt = new Date(dueAt.getTime() - activity.reminderMinutes * 60_000)
        return fireAt <= now && dueAt > now
    })

    if (due.length === 0) {
        log.debug('no reminders due')
        return
    }

    /**
     * Uma transmissão por operador, e **endereçada**.
     *
     * A sala do tempo real é por workspace, então sem `paraUsuario` o lembrete
     * de um atendente chegaria às abas de toda a clínica — o que a regra "o
     * atendente vê só o que é dele" proíbe. O endereçamento é feito por
     * etiqueta de conexão no Durable Object, não por filtro no navegador:
     * filtrar na tela significaria que o dado já viajou.
     */
    const porPessoa = new Map<string, { workspaceId: string; ids: string[] }>()
    for (const activity of due) {
        const chave = `${activity.workspaceId}:${activity.userId}`
        const grupo = porPessoa.get(chave) ?? { workspaceId: activity.workspaceId, ids: [] }
        grupo.ids.push(activity.id)
        porPessoa.set(chave, grupo)
    }

    for (const [chave, grupo] of porPessoa) {
        const userId = chave.slice(chave.indexOf(':') + 1)

        /**
         * Só os ids. A versão anterior mandava título, contato e negócio no
         * próprio evento — ou seja, dado de paciente trafegando pelo canal de
         * tempo real e aparecendo em qualquer log desse caminho. O desenho novo
         * manda identificadores e o navegador busca o conteúdo pela rota
         * autenticada, onde a autorização já acontece.
         */
        await transmitir({
            workspaceId: grupo.workspaceId,
            tipo: 'lembrete',
            dados: { atividadeIds: grupo.ids },
            paraUsuario: userId,
        })
    }

    log.info(`broadcast ${due.length} reminder(s) to ${porPessoa.size} operator(s)`)
}
