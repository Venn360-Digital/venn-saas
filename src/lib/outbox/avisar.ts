import 'server-only'
import type { Prisma } from '@prisma/client'
import { gravarEvento } from './index'

/**
 * Os três avisos que a tela de conversas escuta, com nome e forma fixos.
 *
 * **Por que não chamar `gravarEvento` direto em cada lugar.** O payload é um
 * objeto solto, e a tela lê chaves por nome: `conversationId`, `messageId`,
 * `direction`, `status`. Escrever `conversaId` num dos vinte pontos de emissão
 * não falha em lugar nenhum — o evento é gravado, entregue, e a tela
 * simplesmente não reage. É o defeito mais caro de diagnosticar que este
 * caminho admite, porque tudo em volta parece funcionar.
 *
 * Com estas três funções, a forma do payload existe num lugar só, e
 * `check:tempo-real` confere que as chaves emitidas são as chaves lidas.
 */
export type ClienteDeOutbox = Pick<Prisma.TransactionClient, 'outboxEvent'>

/**
 * As chaves que a tela lê. Exportadas para o teste poder conferir.
 *
 * Não é decoração: é o contrato entre `page.tsx` e os emissores, e ele não tem
 * como ser verificado pelo compilador — o payload é `Record<string, …>` dos
 * dois lados.
 */
export const CHAVES = {
    'mensagem.nova': ['conversationId', 'messageId', 'direction'],
    'mensagem.status': ['conversationId', 'messageId', 'status'],
    'conversa.alterada': ['conversationId'],
} as const

/**
 * Mensagem nova numa conversa.
 *
 * `direction` vai porque a tela decide o **aviso sonoro** com ele: só mensagem
 * recebida avisa, senão o eco da que a atendente acabou de enviar tocaria no
 * ouvido de quem a digitou.
 */
export async function avisarMensagemNova(
    cliente: ClienteDeOutbox,
    dados: { workspaceId: string; conversationId: string; messageId: string; direction: string }
): Promise<void> {
    await gravarEvento(cliente, {
        workspaceId: dados.workspaceId,
        tipo: 'mensagem.nova',
        payload: {
            conversationId: dados.conversationId,
            messageId: dados.messageId,
            direction: dados.direction,
        },
    })
}

/** O selo de entrega andou: enviada → entregue → lida. */
export async function avisarStatusDaMensagem(
    cliente: ClienteDeOutbox,
    dados: { workspaceId: string; conversationId: string; messageId: string; status: string }
): Promise<void> {
    await gravarEvento(cliente, {
        workspaceId: dados.workspaceId,
        tipo: 'mensagem.status',
        payload: {
            conversationId: dados.conversationId,
            messageId: dados.messageId,
            status: dados.status,
        },
    })
}

/** Dono, situação, não-lidas, etiqueta — o que muda a linha na lista. */
export async function avisarConversaAlterada(
    cliente: ClienteDeOutbox,
    dados: { workspaceId: string; conversationId: string }
): Promise<void> {
    await gravarEvento(cliente, {
        workspaceId: dados.workspaceId,
        tipo: 'conversa.alterada',
        payload: { conversationId: dados.conversationId },
    })
}
