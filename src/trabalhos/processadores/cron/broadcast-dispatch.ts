import prisma from '@/lib/prisma'
import { QUEUE } from '@/lib/queue/definitions'
import { enfileirar } from '@/trabalhos/filas'
import { congelarDestinatarios } from '@/trabalhos/servicos/broadcast'
import { createLogger } from '@/trabalhos/registro'

const log = createLogger('CRON:broadcast-dispatch')

/**
 * Dispara as campanhas agendadas cuja hora chegou.
 *
 * O atraso da fila é relativo e limitado (~12h), então "disparar amanhã às 9h"
 * não cabe nele — é esta varredura que resolve. Para cada campanha vencida:
 * congela os destinatários **agora** (a lista fica atual no momento do disparo)
 * e enfileira o fan-out.
 *
 * Idempotente contra corrida: marca `running` dentro de um `updateMany` que só
 * casa enquanto ainda está `scheduled`, então duas passadas não disparam duas
 * vezes a mesma campanha.
 */
export async function runBroadcastDispatch(): Promise<void> {
    const vencidas = await prisma.broadcast.findMany({
        where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
        select: { id: true },
    })

    for (const { id } of vencidas) {
        const reivindicada = await prisma.broadcast.updateMany({
            where: { id, status: 'scheduled' },
            data: { status: 'running', startedAt: new Date() },
        })
        if (reivindicada.count === 0) continue // outra passada pegou

        try {
            const total = await congelarDestinatarios(id)
            if (total === 0) {
                await prisma.broadcast.update({
                    where: { id },
                    data: { status: 'failed', finishedAt: new Date() },
                })
                log.info(`campanha ${id} sem destinatários no disparo; marcada como failed`)
                continue
            }
            // Já está `running` (reivindicada acima de forma atômica, para não
            // disparar em dobro); só falta o fan-out.
            await enfileirar(QUEUE.BROADCAST, { phase: 'fanout', broadcastId: id })
            log.info(`campanha ${id} agendada disparada (${total} destinatários)`)
        } catch (error) {
            log.error(`falha ao disparar campanha agendada ${id}`, error)
        }
    }
}
