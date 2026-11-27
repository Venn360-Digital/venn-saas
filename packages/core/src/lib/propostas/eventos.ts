import { ROTULO_DO_TIPO, type TipoDeDocumento } from './estados'

/**
 * O documento em Conversas — a parte pura.
 *
 * ## Por que o documento tem um fio
 *
 * Pedido da v2 (André, 22/11/2026): "o envio da proposta por e-mail/WhatsApp
 * deve constar em conversas". Até aqui o envio por WhatsApp já aparecia — vai
 * pela conversa aberta —, mas o por e-mail não aparecia em lugar nenhum, e o
 * que o cliente fez com o link (abriu, aceitou) só existia na ficha da
 * proposta. Quem atende olha Conversas, não a ficha.
 *
 * ## O canal `email`
 *
 * Um fio por contato, `channel = 'email'`, sem linha nem agente: é o registro
 * do que saiu por e-mail e do que o cliente fez com isso. Responder por ele
 * ainda não é possível — o módulo de Conversas vai enviar e-mail no futuro, e
 * é aqui que isso entra —, então a tela esconde a caixa de resposta e diz por
 * quê, em vez de gravar uma mensagem com cara de enviada que nunca sai (o
 * mesmo defeito que `api/conversations/[id]/messages` já documentou para o
 * Direct).
 *
 * ## Eventos são mensagens do sistema
 *
 * "Abriu" e "aceitou" entram como mensagem interna com `sentBy = 'sistema'`,
 * para a tela desenhá-las como linha do tempo, não como nota de atendente.
 * Idempotentes por `externalId`: a chave diz qual link e qual evento, e a
 * segunda abertura do mesmo link não gera segunda linha — "ele abriu três
 * vezes" é o relatório de visualizações, não o fio.
 */

/** O canal do fio do documento. */
export const CANAL_DO_DOCUMENTO = 'email'

/** `contentType` da mensagem que leva o link. A tela desenha com o ícone de documento. */
export const CONTEUDO_DOCUMENTO = 'documento'

/** `sentBy` dos eventos: nem agente, nem pessoa. */
export const REMETENTE_SISTEMA = 'sistema'

export type EventoDoDocumento = 'abriu' | 'aceitou'

/** A chave de idempotência do evento, gravada em `Message.externalId`. */
export function chaveDoEvento(shareId: string, evento: EventoDoDocumento): string {
    return `documento:${shareId}:${evento}`
}

function artigo(tipo: TipoDeDocumento): 'a' | 'o' {
    return tipo === 'orcamento' || tipo === 'contrato' ? 'o' : 'a'
}

/** O texto da mensagem que registra o envio por e-mail. */
export function textoDoEnvio(tipo: TipoDeDocumento, numero: number, para: string, url: string): string {
    const rotulo = ROTULO_DO_TIPO[tipo]
    return `${rotulo} ${numero} enviad${artigo(tipo)} por e-mail para ${para}\n${url}`
}

/** O texto do evento, como a tela mostra. */
export function textoDoEvento(evento: EventoDoDocumento, tipo: TipoDeDocumento, numero: number, nome?: string | null): string {
    const rotulo = ROTULO_DO_TIPO[tipo]
    const a = artigo(tipo)
    if (evento === 'abriu') return `O cliente abriu ${a} ${rotulo.toLowerCase()} ${numero}.`
    return `${nome?.trim() || 'O cliente'} aceitou ${a} ${rotulo.toLowerCase()} ${numero}.`
}
