import prisma from '@/lib/prisma'
import { responsavelDaLinha } from '@/lib/rules/atribuicao'
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
        select: { assignedTo: true, handoffAt: true },
    })

    if (!atual) {
        log.warn(`conversation ${pedido.conversationId} is gone; nothing to hand over`)
        return { jaEstava: true }
    }

    if (atual.handoffAt || atual.assignedTo) {
        return { responsavel: atual.assignedTo ?? undefined, jaEstava: true }
    }

    const responsavel = await responsavelDaLinha(pedido.workspaceId, pedido.integrationId)

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
                (responsavel ? '' : '\n\nSem responsável definido: a linha não tem departamento.'),
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
