import prisma from '@/lib/prisma'
import { responsavelDaLinha } from '@/lib/rules/atribuicao'
import { donoDisponivel } from '@/lib/conversas/dono'
import type { MotivoDaEntrega } from '@/lib/atendimento/escalada'
import { createLogger } from '@/trabalhos/registro'

const log = createLogger('ENTREGA')

/**
 * Entregar o atendimento à equipe — um lugar só, três chamadores.
 *
 * Os três: a ferramenta `passar_para_equipe`, que o modelo chama; a escalada por
 * lacunas, decidida no processador; e o teto de interações. O quarto, a regra de
 * ação `notify_human`, mora no executor de regras porque lá o destino vem nos
 * parâmetros da regra, não da linha.
 *
 * Três cópias desta escrita divergiriam na primeira mudança — e uma delas
 * esqueceria `handoffAt`, que é exatamente o defeito que este passo conserta.
 */

export interface PedidoDeEntrega {
    workspaceId: string
    conversationId: string
    /** Por onde a conversa entrou. É daqui que sai o departamento. */
    integrationId: string | null
    motivo: MotivoDaEntrega
    /** A nota interna que o atendente lê. Sem ela a conversa chega sem explicação. */
    nota: string
}

export interface ResultadoDaEntrega {
    /** Quem ficou responsável, quando havia destino. */
    responsavel?: string
    /** A conversa já estava com gente: nada foi escrito. */
    jaEstava: boolean
}

/**
 * Marca a entrega, atribui quando há destino, e deixa a nota.
 *
 * **Idempotente de propósito.** O modelo pode pedir a entrega duas vezes na
 * mesma resposta (duas rodadas de ferramenta), e a escalada por lacunas pode
 * cair sobre uma conversa que a ferramenta acabou de entregar. Reentregar
 * escreveria duas notas e remarcaria o relógio, estragando a conta de "há quanto
 * tempo esta conversa espera uma pessoa" — que é a métrica do Andar 3.
 */
export async function entregarAEquipe(pedido: PedidoDeEntrega): Promise<ResultadoDaEntrega> {
    const atual = await prisma.conversation.findFirst({
        where: { id: pedido.conversationId, workspaceId: pedido.workspaceId },
        select: { assignedTo: true, handoffAt: true, ownerId: true },
    })

    if (!atual) {
        log.warn(`conversation ${pedido.conversationId} is gone; nothing to hand over`)
        return { jaEstava: true }
    }

    if (atual.handoffAt || atual.assignedTo) {
        return { responsavel: atual.assignedTo ?? undefined, jaEstava: true }
    }

    /**
     * **O dono da conversa vem primeiro — se estiver disponível.**
     *
     * Quem já responde por esta conversa é quem deve atendê-la: o paciente não
     * recomeça a explicar, e a carteira faz sentido. Mas o status é lido aqui
     * **sempre**, com o interruptor de distribuição ligado ou desligado, porque
     * são perguntas diferentes: o interruptor decide quem recebe *carteira*,
     * isto decide quem atende *agora*.
     *
     * Dono ausente ou ocupado → cai para a regra da linha, e se ela também não
     * resolver, a entrega vai para a fila geral com `handoffAt` marcado e
     * `assignedTo` nulo — visível a todos. O caso que isto evita é concreto:
     * paciente com dor às 19h, dono designado às 14h já em casa.
     *
     * Ver §11.3.2 do estudo e `lib/conversas/distribuicao.ts`.
     */
    const responsavel =
        (await donoDisponivel(pedido.workspaceId, atual.ownerId)) ??
        (await responsavelDaLinha(pedido.workspaceId, pedido.integrationId))

    await prisma.conversation.update({
        where: { id: pedido.conversationId },
        data: {
            /**
             * `handoffAt` cala o agente; `assignedTo` diz quem atende.
             *
             * **Os dois, e não um.** Só `assignedTo` deixa invisível a entrega sem
             * destino — era o defeito da regra `notify_human`. Só `handoffAt`
             * deixa a conversa calada em "Em espera", onde nenhum atendente a vê
             * como dele.
             */
            handoffAt: new Date(),
            handoffReason: pedido.motivo,
            status: 'active',
            ...(responsavel ? { assignedTo: responsavel } : {}),
        },
    })

    await prisma.message.create({
        data: {
            conversationId: pedido.conversationId,
            direction: 'internal',
            content:
                pedido.nota +
                (responsavel
                    ? ''
                    : atual.ownerId
                      ? '\n\nO responsável por esta conversa não está disponível agora: ela está na fila geral.'
                      : '\n\nSem responsável definido: a linha não tem departamento.'),
            contentType: 'text',
            sentBy: 'agent',
            isInternal: true,
            status: 'sent',
        },
    })

    log.info(
        `conversation ${pedido.conversationId} handed to a human (${pedido.motivo}, ` +
        `${responsavel ? 'assigned' : 'unassigned'})`
    )

    return { responsavel, jaEstava: false }
}
