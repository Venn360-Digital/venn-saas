import { vocab } from '../vocabulario'
import { comArtigo } from '../concordancia'
/**
 * A janela de 24 horas do Instagram, que é regra de produto e não de API.
 *
 * A Meta conta 24 horas desde a **última mensagem do paciente**. Dentro delas,
 * responde quem quiser. Fora delas, só uma pessoa, e o envio tem de ir marcado
 * com a etiqueta `HUMAN_AGENT`, que estende o prazo para 7 dias.
 *
 * **A etiqueta não é um parâmetro a mais: é uma declaração.** Ela existe para
 * atendimento humano — "a clínica estava fechada no fim de semana", "o caso
 * levou mais de um dia" — e usá-la para resposta automática é uso indevido e
 * caminho conhecido para perder o acesso à API. Então a decisão não pode ficar
 * com quem escreve a chamada de envio: fica aqui, derivada do **autor** da
 * mensagem, que o worker já conhece.
 *
 * Daí as três saídas, e nenhuma delas é "manda e vê no que dá":
 *
 * - `enviar` — dentro das 24 h, sem etiqueta;
 * - `enviarComoHumano` — fora das 24 h, até 7 dias, e a mensagem é de uma
 *   pessoa;
 * - `recusar` — o resto, com o motivo em português para a equipe ler na
 *   conversa. Recusar aqui é melhor que deixar a Meta recusar: o erro dela é um
 *   `(#10)` que não diz nada a ninguém, e a mensagem ficaria "falhou" sem
 *   explicação.
 *
 * Nada disto existe no WhatsApp, onde a janela de serviço funciona de outro
 * jeito e os modelos de mensagem resolvem o fora-da-janela. Por isso o módulo é
 * do Instagram, e não do canal.
 */

const HORA = 60 * 60 * 1000
const JANELA_PADRAO_MS = 24 * HORA
const JANELA_HUMANA_MS = 7 * 24 * HORA

/**
 * Os autores que **não** são gente.
 *
 * `Message.sentBy` guarda um destes marcadores ou o **id do usuário** que
 * digitou. Por isso a lista é de máquinas, e não de pessoas: pessoa é tudo o
 * que não está aqui, e um id de usuário novo nunca precisa ser cadastrado.
 *
 * - `agent` — a IA e as regras do agente;
 * - `auto`  — a régua de follow-up automático;
 * - `system`— avisos automáticos (plano vencido, limite de interações);
 * - `user`  — o paciente. Só aparece em mensagem recebida, e está aqui porque
 *   um envio marcado assim seria qualquer coisa menos um atendente da clínica.
 *
 * A lista invertida foi escrita primeiro — "não é agent nem system" — e teria
 * marcado o follow-up automático como atendimento humano, que é exatamente o
 * uso indevido da etiqueta que custa o acesso à API.
 */
const AUTORES_AUTOMATICOS = new Set(['agent', 'auto', 'system', 'user'])

/** Se foi uma pessoa da clínica que escreveu esta mensagem. */
export function ehEnvioDePessoa(sentBy: string | null | undefined): boolean {
    if (!sentBy) return false
    return !AUTORES_AUTOMATICOS.has(sentBy)
}

export type DecisaoDeEnvio =
    | { tipo: 'enviar' }
    | { tipo: 'enviarComoHumano' }
    | { tipo: 'recusar'; motivo: string }

export function decidirEnvioNoInstagram(input: {
    /** O autor, como está em `Message.sentBy`. */
    sentBy: string | null | undefined
    /** Quando o paciente escreveu por último. Nulo quando ele nunca escreveu. */
    ultimaEntrada: Date | null
    agora?: Date
}): DecisaoDeEnvio {
    const { sentBy, ultimaEntrada } = input
    const agora = input.agora ?? new Date()

    /**
     * Ninguém escreveu primeiro: não há janela para estar dentro.
     *
     * No Instagram a conversa é sempre do paciente para a clínica — a Meta não
     * deixa a clínica abrir Direct com quem não a procurou, e não há etiqueta
     * que contorne isso. É o caso da recepção abrindo um atendimento "a frio",
     * e a mensagem precisa dizer isso, não "falhou".
     */
    if (!ultimaEntrada) {
        return {
            tipo: 'recusar',
            motivo:
                'No Instagram só é possível responder a quem escreveu primeiro. ' +
                `Esta conversa ainda não tem mensagem ${comArtigo(vocab(), 'pessoa', 'de')}.`,
        }
    }

    const decorrido = agora.getTime() - ultimaEntrada.getTime()

    if (decorrido <= JANELA_PADRAO_MS) return { tipo: 'enviar' }

    if (!ehEnvioDePessoa(sentBy)) {
        return {
            tipo: 'recusar',
            motivo:
                `Passaram mais de 24 horas desde a última mensagem ${comArtigo(vocab(), 'pessoa', 'de')}, e o ` +
                'Instagram só permite resposta automática dentro desse prazo. Um ' +
                'atendente ainda pode responder por aqui, até 7 dias.',
        }
    }

    if (decorrido <= JANELA_HUMANA_MS) return { tipo: 'enviarComoHumano' }

    return {
        tipo: 'recusar',
        motivo:
            `Passaram mais de 7 dias desde a última mensagem ${comArtigo(vocab(), 'pessoa', 'de')}, e o Instagram ` +
            'não permite mais escrever nesta conversa. Ela volta a abrir se ele escrever ' +
            'de novo.',
    }
}
