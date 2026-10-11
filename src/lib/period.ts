/**
 * O período do produto — os atalhos e a matemática das datas.
 *
 * Mora fora do componente porque o servidor também precisa: o Dashboard nasce
 * em "Este mês" e a Agenda em "Esta semana", e quem resolve esse padrão é o
 * componente de servidor que renderiza a página, antes de existir cliente.
 */

/**
 * Os atalhos, em uma lista só.
 *
 * Cada tela tinha a sua: o funil oferecia 7/30/90 dias, o Dashboard três
 * pastilhas de período, a Agenda seis pastilhas com "Mês Anterior" e
 * "Personalizado". Quem muda de tela reaprendia o controle.
 */
export const PERIOD_PRESETS = [
    { id: 'today', label: 'Hoje' },
    { id: 'week', label: 'Esta semana' },
    { id: 'month', label: 'Este mês' },
    { id: 'd7', label: 'Últimos 7 dias' },
    { id: 'd30', label: 'Últimos 30 dias' },
    { id: 'd90', label: 'Últimos 90 dias' },
] as const

export type PeriodPresetId = (typeof PERIOD_PRESETS)[number]['id']

export interface PeriodRange {
    from: string
    to: string
}

/** `yyyy-MM-dd` no fuso de quem olha — `toISOString()` empurraria o dia. */
export function isoDay(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
}

/**
 * O recorte de um atalho, a partir de um instante.
 *
 * A semana começa no domingo, como no calendário da Agenda — o produto já
 * desenha `Dom Seg Ter…` e duas convenções na mesma tela seriam pior que a
 * escolha.
 */
export function periodRange(id: PeriodPresetId, nowMs: number): PeriodRange {
    const now = new Date(nowMs)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    switch (id) {
        case 'today':
            return { from: isoDay(today), to: isoDay(today) }
        case 'week': {
            const start = new Date(today)
            start.setDate(start.getDate() - start.getDay())
            const end = new Date(start)
            end.setDate(end.getDate() + 6)
            return { from: isoDay(start), to: isoDay(end) }
        }
        case 'month': {
            const start = new Date(now.getFullYear(), now.getMonth(), 1)
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
            return { from: isoDay(start), to: isoDay(end) }
        }
        default: {
            const days = id === 'd7' ? 7 : id === 'd30' ? 30 : 90
            const start = new Date(today)
            start.setDate(start.getDate() - days + 1)
            return { from: isoDay(start), to: isoDay(today) }
        }
    }
}

/** Qual atalho descreve este recorte, se algum. */
export function matchPreset(
    from: string,
    to: string,
    nowMs: number
): PeriodPresetId | null {
    if (!from || !to || !nowMs) return null
    for (const preset of PERIOD_PRESETS) {
        const range = periodRange(preset.id, nowMs)
        if (range.from === from && range.to === to) return preset.id
    }
    return null
}

/**
 * O recorte que a tela deve usar, lido da URL.
 *
 * `period=all` é o "Todo o período" **escolhido**, e precisa existir: sem ele,
 * limpar o filtro numa tela cujo padrão é "Este mês" voltaria para "Este mês"
 * na navegação seguinte, e o botão nunca sairia do lugar.
 */
export function resolvePeriodParams(
    params: { from?: string | null; to?: string | null; period?: string | null },
    fallback: PeriodPresetId,
    /** O agora é lido aqui, e não no componente: a regra `react-hooks/purity`
        proíbe `Date.now()` durante o render — com razão no cliente, e sem jeito
        de distinguir um componente de servidor. */
    nowMs: number = Date.now()
): PeriodRange {
    if (params.period === 'all') return { from: '', to: '' }
    if (params.from || params.to) {
        return { from: params.from ?? '', to: params.to ?? '' }
    }
    return periodRange(fallback, nowMs)
}
