export interface DealLike {
    createdAt: string
    stageId: string
    stageEntries?: { stageId: string; enteredAt: string | null }[]
    activities?: { id: string; title: string; type: string; dueDate: string | null; startTime: string | null }[]
}

/**
 * Quantos dias o negócio está na fase atual.
 *
 * Da última entrada de fase, e não de `updatedAt`: editar o valor de um negócio
 * mexe no `updatedAt` e não significa que ele andou. Sem histórico — os criados
 * pelo webhook antes desta série — cai em `createdAt`, que é a melhor
 * aproximação disponível.
 *
 * `now` entra como argumento porque ler o relógio durante o render é impuro; a
 * tela passa o valor do store (`useNow`).
 */
export function daysInStage(deal: DealLike, now: number): number | null {
    if (!now) return null
    const entries = deal.stageEntries ?? []
    // Passagem sem data registrada não entra na conta: ela diz que a fase
    // aconteceu, não quando. Com só essa, a contagem cai em `createdAt`.
    const current = entries
        .filter((e) => e.stageId === deal.stageId && e.enteredAt)
        .map((e) => new Date(e.enteredAt as string).getTime())
        .sort((a, b) => b - a)[0]
    const since = current ?? new Date(deal.createdAt).getTime()
    return Math.max(0, Math.floor((now - since) / 86_400_000))
}

/** Três faixas de idade, e a cor que cada uma veste. */
export function ageTone(days: number | null): { fill: string; label: string } {
    if (days === null) return { fill: 'bg-muted-foreground/40', label: '' }
    if (days <= 7) return { fill: 'bg-success', label: `${days} ${days === 1 ? 'dia' : 'dias'} nesta fase` }
    if (days <= 14) return { fill: 'bg-warning', label: `${days} dias nesta fase` }
    return { fill: 'bg-destructive', label: `${days} dias nesta fase` }
}

export interface NextStep {
    label: string
    /** `true` quando a data já passou — o cartão precisa dizer isso. */
    overdue: boolean
    missing: boolean
}

/**
 * O próximo passo deste negócio, em uma linha.
 *
 * Três respostas possíveis, e nenhuma delas silenciosa: a atividade marcada,
 * a atividade que já venceu, ou a ausência de qualquer uma — que é o caso mais
 * importante, porque significa que ninguém vai voltar a este paciente.
 */
export function nextStep(deal: DealLike, now: number): NextStep {
    const activity = deal.activities?.[0]
    if (!activity) return { label: 'Sem próxima atividade', overdue: false, missing: true }

    if (!activity.dueDate) {
        return { label: activity.title, overdue: false, missing: false }
    }

    const due = new Date(activity.dueDate)
    const day = due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    const time = activity.startTime ? `, ${activity.startTime}` : ''

    if (!now) return { label: `${day}${time}`, overdue: false, missing: false }

    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const dueDay = new Date(due)
    dueDay.setHours(0, 0, 0, 0)
    const diff = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000)

    if (diff < 0) return { label: `Era ${day}${time}`, overdue: true, missing: false }
    if (diff === 0) return { label: `Hoje${time}`, overdue: false, missing: false }
    if (diff === 1) return { label: `Amanhã${time}`, overdue: false, missing: false }
    return { label: `${day}${time}`, overdue: false, missing: false }
}
