import type { TipoDeEvento } from '@/lib/outbox'
import { createLogger } from './registro'

/**
 * Transmissão efêmera, direta para a sala do workspace.
 *
 * **Por que não pelo outbox.** O outbox existe para o evento que não pode se
 * perder se o `commit` aconteceu — mensagem nova, conversa alterada — e o preço
 * dele é uma gravação no banco mais a varredura de cada minuto. "Está
 * digitando" é o oposto: perder não custa nada e atrasar custa tudo. Mandar o
 * indicador de digitação pelo outbox o entregaria depois de a pessoa já ter
 * terminado de escrever.
 *
 * Então são dois caminhos de propósito, com critério claro: **tem de chegar →
 * outbox; tem de chegar agora → aqui.**
 *
 * Substitui o `broadcast` do canal do cliente anterior, que fazia
 * exatamente isto no tempo real daquela plataforma.
 */
const log = createLogger('TEMPO-REAL')

export interface Transmissao {
    workspaceId: string
    tipo: TipoDeEvento
    /** Identificadores, nunca conteúdo — a mesma regra do outbox. */
    dados: Record<string, unknown>
    /**
     * Entregar só às conexões desta pessoa.
     *
     * Sem isto, um lembrete de atividade de um atendente chegaria a todas as
     * abas da clínica. Não é só ruído: atividade sem relação com quem recebe é
     * justamente o que a regra "o atendente vê só o que é dele" proíbe.
     */
    paraUsuario?: string
}

/** Quem leva a transmissão. Registrado pelo Worker, que tem os bindings. */
export type Transmissor = (t: Transmissao) => Promise<void>

let transmissor: Transmissor | null = null

export function registrarTransmissor(t: Transmissor): void {
    transmissor = t
}

/**
 * Transmite, e **não lança** quando não há transmissor.
 *
 * Diferente de `enfileirar`, que lança. A assimetria é deliberada: enfileirar é
 * o trabalho, e perdê-lo em silêncio esconde um defeito; transmitir é enfeite
 * de tela, e derrubar o processamento de uma mensagem porque o indicador de
 * digitação não pôde ser entregue trocaria um problema pequeno por um grande.
 */
export async function transmitir(t: Transmissao): Promise<void> {
    if (!transmissor) {
        log.debug(`sem transmissor registrado; "${t.tipo}" descartado`)
        return
    }

    try {
        await transmissor(t)
    } catch (erro) {
        log.warn(`falha ao transmitir "${t.tipo}"`, erro instanceof Error ? erro.message : erro)
    }
}
