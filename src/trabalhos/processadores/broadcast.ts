import type { BroadcastJob } from '@/lib/queue/definitions'
import { fanOut, enviarDestinatario } from '@/trabalhos/servicos/broadcast'

/**
 * Processa um trabalho de campanha, nas duas fases.
 *
 * `fanout` expande a campanha nos envios pendentes (escalonados pelo ritmo);
 * `send` entrega o template a um destinatário. O id de dedup da fila é o
 * `recipientId` (ver `IDS_DE_DEDUP` em src/cloudflare/entrada.ts), então uma
 * reentrega do mesmo `send` não reenvia ao paciente.
 */
export async function processBroadcast(payload: BroadcastJob): Promise<void> {
    if (payload.phase === 'fanout') {
        await fanOut(payload.broadcastId)
        return
    }
    await enviarDestinatario(payload.broadcastId, payload.recipientId)
}
