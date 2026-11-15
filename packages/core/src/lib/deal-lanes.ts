import type { Prisma } from '@venn/db'
import { FUSO_DO_NEGOCIO, diaNoFuso, inicioDoDiaUtc, somarDias } from './fuso'
import type { Vocabulario } from './vocabulario'
import { comArtigo } from './concordancia'

/**
 * As três perguntas que a clínica faz todo dia ao funil.
 *
 * Cada faixa é uma **consulta**, não um rótulo: o número que aparece na tela e
 * a lista que o clique filtra saem daqui, do mesmo filtro. Era o jeito de
 * garantir que "7 parados" e o que o quadro mostra ao clicar nunca discordem —
 * duas expressões diferentes para a mesma pergunta divergem no primeiro caso de
 * borda.
 */
export type DealLane = 'due_soon' | 'stalled' | 'no_activity'

/**
 * O vocabulário entra por PARÂMETRO, e é obrigatório.
 *
 * Este módulo é alcançado pelo bundle do CLIENTE, e no navegador ninguém
 * registrou a marca: ler `vocab()` por dentro lançava
 * `MarcaNaoRegistradaError` na hidratação — depois de compilar, buildar e
 * publicar sem uma reclamação. Medido em 15/11/2026, e era defeito em
 * produção. No cliente as palavras vêm de `useVocab()`; no servidor, de
 * `vocab(settings)`. Na assinatura, a cobrança é do compilador.
 *
 * A memoização de módulo saiu junto: o resultado depende do argumento, e um
 * cache global devolveria a palavra da primeira unidade a todas as outras.
 */
export function DEAL_LANES(v: Vocabulario): { id: DealLane; label: string; hint: string }[] {
    return [
        { id: 'due_soon', label: 'consultas hoje e amanhã', hint: 'Atividade marcada para hoje ou amanhã' },
        { id: 'stalled', label: 'parados há mais de 7 dias', hint: 'Sem mudar de fase há mais de uma semana' },
        { id: 'no_activity', label: 'sem próxima atividade', hint: `Nenhuma atividade pendente — ninguém vai voltar a ${comArtigo(v, 'pessoa', 'este')}` },
    ]
}

export function isDealLane(value: string | null | undefined): value is DealLane {
    return value === 'due_soon' || value === 'stalled' || value === 'no_activity'
}

/** Dias sem mudar de fase para um negócio contar como parado. */
const STALE_DAYS = 7

/**
 * `fuso` só muda a faixa `due_soon` — as outras duas contam em dias corridos.
 *
 * "Hoje e amanhã" é a única das três que depende de onde a clínica está: em
 * Sydney o dia virou nove horas antes, e sem isto a lista de consultas de hoje
 * mostraria as de ontem até as 11h da manhã local. O padrão mantém o
 * comportamento de quem chama sem passar nada.
 */
export function laneWhere(
    lane: DealLane,
    now: Date = new Date(),
    fuso: string = FUSO_DO_NEGOCIO
): Prisma.DealWhereInput {
    if (lane === 'due_soon') {
        // `dueDate` é data sem hora: a fronteira é meia-noite UTC, mas o dia
        // é o da clínica — ver `inicioDoDiaUtc`.
        const hoje = diaNoFuso(now, fuso)
        const start = inicioDoDiaUtc(hoje)
        const end = inicioDoDiaUtc(somarDias(hoje, 2))
        return { activities: { some: { completedAt: null, dueDate: { gte: start, lt: end } } } }
    }

    if (lane === 'no_activity') {
        return { activities: { none: { completedAt: null } } }
    }

    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - STALE_DAYS)

    /**
     * Parado = a entrada mais recente de fase é mais velha que o corte.
     *
     * Expresso como "nenhuma entrada depois do corte", que é equivalente —
     * entradas só são acrescentadas, então a mais nova é sempre a da fase atual
     * — e cabe no filtro do Prisma sem SQL cru.
     *
     * O segundo termo cuida do negócio **sem nenhuma entrada**: os criados pelo
     * webhook antes desta série de mudanças não têm histórico, e sem ele todos
     * eles contariam como parados, inclusive os de hoje.
     */
    return {
        AND: [
            { stageEntries: { none: { enteredAt: { gte: cutoff } } } },
            { OR: [{ stageEntries: { some: {} } }, { createdAt: { lt: cutoff } }] },
        ],
    }
}
