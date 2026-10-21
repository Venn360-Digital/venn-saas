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

/**
 * Publica agora o que está pendente, sem esperar a varredura.
 *
 * **Por que isto é obrigatório e não otimização.** A varredura da outbox pega o
 * disparo `* * * * *`, e Cron Triggers têm granularidade de um minuto. Sem um
 * caminho imediato, uma mensagem de paciente levaria **até 60 segundos** para
 * chegar à tela — ou seja, o polling de 15 s que este caminho veio substituir
 * ganharia dele, sempre. O tempo real seria enfeite caro.
 *
 * Então são dois caminhos para o mesmo evento, e os dois são necessários:
 *
 *   - **este**, imediato, logo depois do `commit`, é o que entrega rápido;
 *   - **a varredura**, de minuto, é a rede: pega o que este perdeu porque o
 *     isolate morreu, a sala estava indisponível, ou a publicação falhou.
 *
 * Entregar duas vezes é de graça: a sala descarta repetido por id, e o cliente
 * também. É exatamente para isso que o id existe.
 */
export type PublicadorImediato = () => Promise<void>

let imediato: PublicadorImediato | null = null

export function registrarPublicadorImediato(p: PublicadorImediato): void {
    imediato = p
}

/**
 * Dispara a publicação e **não espera**.
 *
 * `void` de propósito: quem acabou de gravar a mensagem não deve esperar o
 * fan-out para responder ao atendente. E não lança — o evento já está na
 * outbox, então o pior caso é a varredura entregá-lo no minuto seguinte, que é
 * o comportamento de antes desta função existir.
 */
export function publicarAgora(): void {
    if (!imediato) return

    void imediato().catch((erro) => {
        console.error('[OUTBOX] publicação imediata falhou; a varredura pega:', erro)
    })
}
