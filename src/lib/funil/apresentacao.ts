import type { ToneEntry } from '@/components/shared/StatusBadge'

import { lerGatilho, TEXTO_DO_GATILHO } from './gatilho'
import { TIPOS_DE_PASSO, type TipoDePasso } from './passos'

/**
 * Como o funil aparece na tela.
 *
 * Fica fora dos componentes por um motivo concreto: a página servidora e o
 * cliente precisam da **mesma** projeção, e duas cópias divergiriam no primeiro
 * rótulo novo. É o mesmo arranjo de `lib/marketing/apresentacao.ts`.
 */

export const SITUACAO_DO_FUNIL: Record<string, ToneEntry> = {
    draft: { label: 'Rascunho', tone: 'neutral' },
    published: { label: 'Publicado', tone: 'success' },
}

/**
 * O desfecho de uma passagem.
 *
 * `stopped` é **neutro**, não ruim: "a recepção assumiu a conversa" é o funil
 * funcionando como desenhado. Pintá-lo de vermelho faria a dona da clínica
 * achar que algo quebrou justamente quando o produto se comportou bem.
 */
export const DESFECHO_DA_PASSAGEM: Record<string, ToneEntry> = {
    running: { label: 'Dentro', tone: 'info' },
    done: { label: 'Terminou', tone: 'success' },
    stopped: { label: 'Parou', tone: 'neutral' },
    failed: { label: 'Falhou', tone: 'destructive' },
}

/** O rótulo de cada tipo de passo, na ordem em que o painel os oferece. */
export const NOME_DO_PASSO: Record<TipoDePasso, string> = {
    mensagem: 'Enviar mensagem',
    espera: 'Esperar',
    condicao: 'Se / então',
    etiquetar: 'Aplicar etiqueta',
    mover_etapa: 'Mover de etapa',
    atribuir: 'Atribuir a alguém',
    encerrar: 'Encerrar',
}

/** Os tipos na ordem em que fazem sentido oferecer a quem desenha. */
export const PASSOS_NA_PALETA: TipoDePasso[] = TIPOS_DE_PASSO

/**
 * O gatilho em uma frase, para a listagem.
 *
 * Gatilho ilegível vira "Sem gatilho" e **não** uma frase vazia: um funil
 * listado com a coluna em branco parece erro de carregamento, e o que é na
 * verdade é um funil que não vai receber ninguém — informação que a pessoa
 * precisa ver.
 */
export function frasedoGatilho(trigger: unknown): string {
    const g = lerGatilho(trigger)
    if (!g) return 'Sem gatilho'
    return TEXTO_DO_GATILHO[g.tipo]
}

/**
 * A espera em palavras: "3 dias", "2 h", "45 min".
 *
 * Em dias quando fecha em dias, porque é assim que quem desenha pensa — "três
 * dias depois", não "4.320 minutos".
 */
export function esperaEmPalavras(minutos: number): string {
    if (minutos <= 0) return 'sem espera'
    if (minutos % (24 * 60) === 0) {
        const dias = minutos / (24 * 60)
        return dias === 1 ? '1 dia' : `${dias} dias`
    }
    if (minutos % 60 === 0) {
        const horas = minutos / 60
        return horas === 1 ? '1 hora' : `${horas} horas`
    }
    return `${minutos} min`
}
