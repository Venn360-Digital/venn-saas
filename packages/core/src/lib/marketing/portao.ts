import 'server-only'
import prisma from '@venn/db/cliente'
import { canBroadcast } from '../limits'
import { whereDeDestinatarios } from './lists'
import { ehCanalDeCampanha, type CanalDeCampanha } from './apresentacao'

/**
 * O portão que toda campanha atravessa antes de sair — **nos dois caminhos**.
 *
 * ## Por que isto não mora na rota
 *
 * Há duas portas para o disparo: `POST /api/marketing/campaigns/[id]/send`
 * (imediato) e o cron `broadcast-dispatch` (agendado). A rota conferia; o cron
 * não.
 *
 * O buraco era real e silencioso. Uma campanha agendada para a semana seguinte
 * passa dias parada, e nesse intervalo o cliente pode ter tirado o CNAME do
 * DKIM da zona dele, a linha oficial pode ter caído, e a conta pode ter
 * estourado o teto do mês com outro disparo. O cron dispararia assim mesmo, e
 * o fan-out descobriria destinatário a destinatário — marcando a campanha
 * inteira como falha, de madrugada, sem ninguém para ler.
 *
 * Com o portão num lugar só, as duas portas recusam pelo mesmo motivo e com a
 * mesma mensagem.
 */

export interface Recusa {
    error: string
    /** 400 para configuração incompleta; 402 quando é teto de plano. */
    status: 400 | 402
}

/** O recorte da campanha que o portão precisa ler. */
const SELECT_DO_PORTAO = {
    id: true,
    channel: true,
    workspaceId: true,
    integrationId: true,
    sender: { select: { status: true, domain: true } },
    lists: { select: { listId: true } },
} as const

/**
 * Pode disparar? `null` quando sim.
 *
 * Confere, nesta ordem: a configuração do canal (o que falta é acionável pela
 * clínica), quantos destinatários a lista alcança, e o teto do plano. O teto
 * fica por último porque é o mais caro — duas consultas — e não adianta
 * perguntá-lo para uma campanha que não ia sair de qualquer jeito.
 */
export async function portaoDeDisparo(
    broadcastId: string
): Promise<{ ok: true; canal: CanalDeCampanha; total: number } | ({ ok: false } & Recusa)> {
    const b = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: SELECT_DO_PORTAO,
    })
    if (!b) return { ok: false, error: 'Campanha não encontrada.', status: 400 }

    const canal: CanalDeCampanha = ehCanalDeCampanha(b.channel) ? b.channel : 'whatsapp'

    const faltando = oQueFalta(canal, b)
    if (faltando) return { ok: false, error: faltando, status: 400 }

    const listIds = b.lists.map((l) => l.listId)
    const total =
        listIds.length === 0
            ? 0
            : await prisma.contact.count({
                  // O MESMO predicado do congelamento. Separados, a conferência
                  // do plano usaria um número e o disparo outro.
                  where: whereDeDestinatarios(b.workspaceId, canal, listIds),
              })

    if (total === 0) {
        return { ok: false, error: semDestinatarios(canal), status: 400 }
    }

    const permitido = await canBroadcast(b.workspaceId, total, canal)
    if (!permitido.ok) {
        return { ok: false, error: permitido.error ?? 'Teto do plano atingido.', status: 402 }
    }

    return { ok: true, canal, total }
}

/** O que falta para o canal poder disparar, ou `null` quando nada falta. */
function oQueFalta(
    canal: CanalDeCampanha,
    b: {
        integrationId: string | null
        sender: { status: string; domain: string } | null
    }
): string | null {
    if (canal === 'email') {
        if (!b.sender) return 'A campanha não tem remetente de e-mail.'
        if (b.sender.status !== 'verified') {
            return `O domínio ${b.sender.domain} não está verificado. Publique os três registros de DNS antes de disparar.`
        }
        return null
    }
    if (!b.integrationId) return 'A campanha não tem linha de envio.'
    return null
}

/** Por que a lista ficou vazia — e a resposta muda com o canal. */
export function semDestinatarios(canal: CanalDeCampanha): string {
    return canal === 'email'
        ? 'As listas não têm ninguém com e-mail cadastrado que não tenha cancelado a inscrição.'
        : 'As listas não têm ninguém com telefone válido que não tenha pedido para parar.'
}
