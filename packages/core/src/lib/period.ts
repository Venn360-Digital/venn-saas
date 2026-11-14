import { FUSO_DO_NEGOCIO, diaDaSemana, diaNoFuso, limitesDoMes, somarDias } from './fuso'

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

/**
 * `yyyy-MM-dd` no **fuso da unidade** — não no de quem olha, e não em UTC.
 *
 * Era `date.getDate()` & cia., que lê o fuso do processo. Funcionava na VPS
 * (`TZ=America/Sao_Paulo`) e passou a dar UTC no Worker, que ignora `TZ`: às
 * 22h de Brasília o servidor já resolvia "hoje" como o dia seguinte, e o filtro
 * da tela deixava de bater com o número que voltava do banco.
 *
 * O fuso tem de ser **o mesmo nas duas pontas**, e é por isso que ele entra
 * como argumento em vez de cada lado descobrir o seu: o cliente pega de
 * `useFusoDaUnidade`, o servidor de `fusoDaUnidade`, e os dois leem a mesma
 * coluna. Dois fusos diferentes aqui reproduzem exatamente o defeito que este
 * módulo existe para fechar — a tela filtrando um dia e o banco respondendo
 * outro.
 */
export function isoDay(date: Date, fuso: string = FUSO_DO_NEGOCIO): string {
    return diaNoFuso(date, fuso)
}

/**
 * O recorte de um atalho, a partir de um instante.
 *
 * A semana começa no domingo, como no calendário da Agenda — o produto já
 * desenha `Dom Seg Ter…` e duas convenções na mesma tela seriam pior que a
 * escolha.
 */
export function periodRange(
    id: PeriodPresetId,
    nowMs: number,
    fuso: string = FUSO_DO_NEGOCIO
): PeriodRange {
    // Tudo em cima do dia de calendário da unidade, nunca de um instante com
    // fuso implícito — ver `isoDay`.
    const hoje = diaNoFuso(new Date(nowMs), fuso)

    switch (id) {
        case 'today':
            return { from: hoje, to: hoje }
        case 'week': {
            const inicio = somarDias(hoje, -diaDaSemana(hoje))
            return { from: inicio, to: somarDias(inicio, 6) }
        }
        case 'month': {
            const { primeiro, ultimo } = limitesDoMes(hoje)
            return { from: primeiro, to: ultimo }
        }
        default: {
            const days = id === 'd7' ? 7 : id === 'd30' ? 30 : 90
            return { from: somarDias(hoje, -(days - 1)), to: hoje }
        }
    }
}

/** Qual atalho descreve este recorte, se algum. */
export function matchPreset(
    from: string,
    to: string,
    nowMs: number,
    fuso: string = FUSO_DO_NEGOCIO
): PeriodPresetId | null {
    if (!from || !to || !nowMs) return null
    for (const preset of PERIOD_PRESETS) {
        const range = periodRange(preset.id, nowMs, fuso)
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
    nowMs: number = Date.now(),
    fuso: string = FUSO_DO_NEGOCIO
): PeriodRange & { preset: PeriodPresetId | null } {
    if (params.period === 'all') return { from: '', to: '', preset: null }
    if (params.from || params.to) {
        const range = { from: params.from ?? '', to: params.to ?? '' }
        return { ...range, preset: matchPreset(range.from, range.to, nowMs, fuso) }
    }
    return { ...periodRange(fallback, nowMs, fuso), preset: fallback }
}
