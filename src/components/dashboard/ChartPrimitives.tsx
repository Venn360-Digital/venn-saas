import { cn } from '@/lib/utils'

/**
 * As peças de que os nove gráficos são feitos.
 *
 * Tudo aqui é SVG e CSS desenhados à mão, sem biblioteca: o painel é componente
 * de servidor — os números já vêm no HTML, sem piscar — e uma biblioteca de
 * gráficos arrastaria a tela inteira para o cliente para desenhar o que cabe em
 * um `<polyline>`.
 *
 * O valor de cada marca é alcançável no hover pelo `<title>` nativo do SVG, que
 * não custa um byte de JavaScript. Tooltip desenhada exigiria estado, e estado
 * exigiria cliente.
 *
 * Cor: **uma** carrega sentido por gráfico (`chart-series`). Período anterior é
 * forma — tracejado em `muted-foreground` —, nunca uma segunda cor; medido, dois
 * teais vizinhos dão 1,43:1 entre si e ninguém separaria "este mês" de "mês
 * passado". Ver o comentário de `--chart-series` em `globals.css`.
 */

const BRL = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
})

/** "R$ 41,8 mil" — o eixo não comporta "R$ 41.800" em cada marca. */
export function compactBRL(value: number): string {
    if (Math.abs(value) >= 1000) {
        return `R$ ${(value / 1000).toFixed(1).replace('.', ',')} mil`
    }
    return BRL.format(value)
}

export function fullBRL(value: number): string {
    return BRL.format(value)
}

export function ChartCard({
    title,
    hint,
    children,
    footer,
    className,
}: {
    title: string
    hint?: string
    children: React.ReactNode
    footer?: React.ReactNode
    className?: string
}) {
    return (
        <section className={cn('flex flex-col rounded-lg border border-border bg-card', className)}>
            <header className="border-b border-border px-5 py-4">
                <h3 className="text-h3">{title}</h3>
                {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
            </header>
            <div className="flex-1 px-5 py-4">{children}</div>
            {footer ? (
                <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                    {footer}
                </p>
            ) : null}
        </section>
    )
}

/** O número grande de um cartão, com a comparação ao lado. */
export function ChartHero({
    value,
    delta,
    hint,
}: {
    value: string
    delta?: { text: string; direction: 'up' | 'down' | 'flat'; good: boolean } | null
    hint?: string
}) {
    return (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="num text-h1">{value}</span>
            {delta ? (
                <span
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                        delta.direction === 'flat'
                            ? 'bg-muted text-muted-foreground'
                            : delta.good
                                ? 'bg-success-subtle text-success-subtle-foreground'
                                : 'bg-destructive-subtle text-destructive-subtle-foreground'
                    )}
                >
                    <Arrow direction={delta.direction} />
                    {delta.text}
                </span>
            ) : null}
            {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
        </div>
    )
}

/** A seta vai junto do número: cor sozinha não diz "subiu" a quem não a vê. */
export function Arrow({ direction }: { direction: 'up' | 'down' | 'flat' }) {
    return (
        <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            aria-hidden="true"
        >
            {direction === 'up' ? (
                <path d="M12 19V5M5 12l7-7 7 7" />
            ) : direction === 'down' ? (
                <path d="M12 5v14M5 12l7 7 7-7" />
            ) : (
                <path d="M5 12h14" />
            )}
        </svg>
    )
}

export interface BarRow {
    key: string
    label: string
    /** 0 a 100. */
    percent: number
    /** O número à direita do rótulo. */
    value: string
    /** Linha fina embaixo da barra. */
    note?: string
    /** Ponto colorido antes do rótulo — cor de fase, vinda do banco. */
    dot?: string
    tone?: 'series' | 'loss' | 'warn' | 'muted'
}

/**
 * Barras ordenadas num matiz só.
 *
 * É a resposta medida para "N categorias": a paleta da marca não sustenta cinco
 * identidades por cor, então **comprimento mede e rótulo identifica**. Onde a
 * categoria tem cor própria no banco — a fase do funil — ela entra como um
 * ponto de 9px com anel, não como a cor da barra; sem o anel, uma fase navy
 * desaparece no cartão escuro.
 */
export function BarList({ rows, className }: { rows: BarRow[]; className?: string }) {
    return (
        <ul className={cn('space-y-3', className)}>
            {rows.map((row) => (
                <li key={row.key}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                            {row.dot ? (
                                <span
                                    aria-hidden="true"
                                    className="size-2.5 shrink-0 rounded-full border border-border-strong"
                                    style={{ backgroundColor: row.dot }}
                                />
                            ) : null}
                            <span className="truncate">{row.label}</span>
                        </span>
                        <span className="num shrink-0 text-sm font-semibold">{row.value}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                        <div
                            className={cn(
                                'h-full rounded-full',
                                row.tone === 'loss'
                                    ? 'bg-destructive-subtle-foreground'
                                    : row.tone === 'warn'
                                        ? 'bg-warning-subtle-foreground'
                                        : row.tone === 'muted'
                                            ? 'bg-border-strong'
                                            : 'bg-chart-series'
                            )}
                            style={{ width: `${Math.max(row.percent, 1.5)}%` }}
                        />
                    </div>
                    {row.note ? (
                        <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>
                    ) : null}
                </li>
            ))}
        </ul>
    )
}

export function EmptyChart({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full min-h-28 items-center justify-center rounded-md border border-dashed border-border px-4 py-6">
            <p className="text-center text-sm text-muted-foreground">{children}</p>
        </div>
    )
}

interface Point {
    label: string
    current: number
    previous: number
}

/** Onde o eixo Y para, arredondado para um número que se lê. */
function niceMax(value: number): number {
    if (value <= 0) return 1
    const magnitude = 10 ** Math.floor(Math.log10(value))
    for (const step of [1, 2, 2.5, 5, 10]) {
        if (magnitude * step >= value) return magnitude * step
    }
    return magnitude * 10
}

/**
 * Acumulado, contra o mesmo ponto do período anterior.
 *
 * Acumulado em vez de barras diárias porque a pergunta é "chegamos onde
 * devíamos a esta altura", não "quanto entrou terça". A área à direita do
 * último ponto fica vazia de propósito: ela é quanto do período ainda falta.
 */
export function CumulativeChart({
    points,
    format,
    labelCurrent,
    labelPrevious,
}: {
    points: Point[]
    format: (value: number) => string
    labelCurrent: string
    labelPrevious: string
}) {
    const W = 660
    const H = 220
    const left = 52
    const right = 626
    const top = 18
    const bottom = 170

    const max = niceMax(
        Math.max(1, ...points.map((p) => Math.max(p.current, p.previous)))
    )
    const step = points.length > 1 ? (right - left) / (points.length - 1) : 0
    const x = (i: number) => left + i * step
    const y = (v: number) => bottom - (v / max) * (bottom - top)

    const line = (key: 'current' | 'previous') =>
        points.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')

    const last = points.at(-1)
    // O rótulo do meio some quando ele repete uma das pontas: com um máximo
    // pequeno, "R$ 1 / R$ 1 / R$ 0" arredondava para o mesmo texto duas vezes e
    // o eixo passava a mentir sobre a escala. A linha fica; o texto é que sai.
    const midLabel = format(max / 2)
    const showMid = midLabel !== format(0) && midLabel !== format(max)
    const gridValues: { value: number; label: string | null }[] = [
        { value: 0, label: format(0) },
        { value: max / 2, label: showMid ? midLabel : null },
        { value: max, label: format(max) },
    ]

    return (
        <figure className="m-0">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="block h-auto w-full"
                role="img"
                aria-label={`${labelCurrent}: ${format(last?.current ?? 0)}. ${labelPrevious}: ${format(last?.previous ?? 0)}.`}
            >
                {gridValues.map((grid) => (
                    <g key={grid.value}>
                        <line
                            x1={left}
                            y1={y(grid.value)}
                            x2={right}
                            y2={y(grid.value)}
                            className="stroke-border"
                            strokeWidth="1"
                        />
                        {grid.label ? (
                            <text
                                x={left - 8}
                                y={y(grid.value) + 3.5}
                                textAnchor="end"
                                className="num fill-muted-foreground text-[10px]"
                            >
                                {grid.label}
                            </text>
                        ) : null}
                    </g>
                ))}

                {/* Período anterior: tracejado neutro. */}
                <polyline
                    points={line('previous')}
                    fill="none"
                    className="stroke-muted-foreground"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                    strokeLinejoin="round"
                />

                {/* Período atual: a única cor com significado. */}
                <path
                    d={`M${line('current').split(' ').join(' L')} L${x(points.length - 1).toFixed(1)},${bottom} L${left},${bottom} Z`}
                    className="fill-chart-series"
                    opacity="0.1"
                />
                <polyline
                    points={line('current')}
                    fill="none"
                    className="stroke-chart-series"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />

                {points.map((p, i) => (
                    <g key={p.label}>
                        <title>
                            {`${p.label} — ${labelCurrent} ${format(p.current)} · ${labelPrevious} ${format(p.previous)}`}
                        </title>
                        <rect
                            x={x(i) - step / 2}
                            y={top}
                            width={Math.max(step, 6)}
                            height={bottom - top}
                            fill="transparent"
                        />
                    </g>
                ))}

                {last ? (
                    <circle
                        cx={x(points.length - 1)}
                        cy={y(last.current)}
                        r="4.5"
                        className="fill-chart-series stroke-card"
                        strokeWidth="2"
                    />
                ) : null}

                {/* Eixo X: no máximo seis rótulos, senão viram uma régua ilegível. */}
                {points.map((p, i) => {
                    const every = Math.max(1, Math.ceil(points.length / 6))
                    if (i % every !== 0 && i !== points.length - 1) return null
                    return (
                        <text
                            key={`x-${p.label}-${i}`}
                            x={x(i)}
                            y={bottom + 16}
                            textAnchor="middle"
                            className="num fill-muted-foreground text-[10px]"
                        >
                            {p.label}
                        </text>
                    )
                })}
            </svg>
            <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded-full bg-chart-series" />
                    {labelCurrent}
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span
                        aria-hidden="true"
                        className="inline-block w-4 border-t-2 border-dashed border-muted-foreground"
                    />
                    {labelPrevious}
                </span>
            </figcaption>
        </figure>
    )
}

/**
 * Criadas × concluídas: contorno é o que entrou, preenchido é o que saiu.
 *
 * A mesma gramática do acumulado — cheio é o que aconteceu, contorno é a
 * referência —, e por isso as duas não precisam de duas cores.
 */
export function PairedBars({
    points,
    labelCurrent,
    labelPrevious,
}: {
    points: Point[]
    labelCurrent: string
    labelPrevious: string
}) {
    const W = 660
    const H = 200
    const left = 40
    const right = 640
    const top = 16
    const bottom = 158

    const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.current, p.previous))))
    const slot = (right - left) / Math.max(points.length, 1)
    const outerW = Math.min(44, slot * 0.72)
    const innerW = outerW * 0.62
    const y = (v: number) => bottom - (v / max) * (bottom - top)

    return (
        <figure className="m-0">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="block h-auto w-full"
                role="img"
                aria-label={`${labelPrevious} e ${labelCurrent} por período`}
            >
                {[0, max / 2, max].map((value) => (
                    <g key={value}>
                        <line
                            x1={left}
                            y1={y(value)}
                            x2={right}
                            y2={y(value)}
                            className="stroke-border"
                            strokeWidth="1"
                        />
                        <text
                            x={left - 8}
                            y={y(value) + 3.5}
                            textAnchor="end"
                            className="num fill-muted-foreground text-[10px]"
                        >
                            {Math.round(value)}
                        </text>
                    </g>
                ))}

                {points.map((p, i) => {
                    const cx = left + slot * i + slot / 2
                    const outerH = Math.max(2, bottom - y(p.previous))
                    const innerH = Math.max(2, bottom - y(p.current))
                    const every = Math.max(1, Math.ceil(points.length / 8))
                    return (
                        <g key={`${p.label}-${i}`}>
                            <title>
                                {`${p.label} — ${labelPrevious} ${p.previous} · ${labelCurrent} ${p.current}`}
                            </title>
                            <rect
                                x={cx - outerW / 2}
                                y={bottom - outerH}
                                width={outerW}
                                height={outerH}
                                rx="4"
                                fill="none"
                                className="stroke-muted-foreground"
                                strokeWidth="1.5"
                                strokeDasharray="4 3"
                            />
                            <rect
                                x={cx - innerW / 2}
                                y={bottom - innerH}
                                width={innerW}
                                height={innerH}
                                rx="4"
                                className="fill-chart-series"
                            />
                            {i % every === 0 ? (
                                <text
                                    x={cx}
                                    y={bottom + 16}
                                    textAnchor="middle"
                                    className="num fill-muted-foreground text-[10px]"
                                >
                                    {p.label}
                                </text>
                            ) : null}
                        </g>
                    )
                })}
            </svg>
            <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-chart-series" />
                    {labelCurrent}
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span
                        aria-hidden="true"
                        className="inline-block size-2.5 rounded-sm border-[1.5px] border-dashed border-muted-foreground"
                    />
                    {labelPrevious}
                </span>
            </figcaption>
        </figure>
    )
}

/**
 * Uma linha, com a média do período anterior como régua.
 *
 * Uma série só, então não há legenda: o título já diz o que a linha é. O período
 * anterior entra como referência reta em vez de segunda linha — duas linhas
 * disputando a mesma leitura é o que faz ninguém ler nenhuma.
 */
export function ReferenceLineChart({
    points,
    reference,
    referenceLabel,
}: {
    points: { label: string; rate: number | null }[]
    reference: number | null
    referenceLabel: string
}) {
    const W = 660
    const H = 200
    const left = 44
    const right = 596
    const top = 18
    const bottom = 156

    const step = points.length > 1 ? (right - left) / (points.length - 1) : 0
    const x = (i: number) => left + i * step
    const y = (v: number) => bottom - (v / 100) * (bottom - top)

    const drawn = points
        .map((p, i) => ({ ...p, i }))
        .filter((p): p is { label: string; rate: number; i: number } => p.rate !== null)
    const last = drawn.at(-1)

    return (
        <figure className="m-0">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="block h-auto w-full"
                role="img"
                aria-label={`Taxa de conversão por período. ${reference !== null ? `Referência: ${reference.toFixed(0)}% no período anterior.` : ''}`}
            >
                {[0, 25, 50, 75, 100].map((value) => (
                    <g key={value}>
                        <line
                            x1={left}
                            y1={y(value)}
                            x2={right}
                            y2={y(value)}
                            className="stroke-border"
                            strokeWidth="1"
                        />
                        <text
                            x={left - 8}
                            y={y(value) + 3.5}
                            textAnchor="end"
                            className="num fill-muted-foreground text-[10px]"
                        >
                            {value}%
                        </text>
                    </g>
                ))}

                {reference !== null ? (
                    <g>
                        <line
                            x1={left}
                            y1={y(reference)}
                            x2={right}
                            y2={y(reference)}
                            className="stroke-muted-foreground"
                            strokeWidth="1.5"
                            strokeDasharray="5 4"
                        />
                        <text
                            x={right + 6}
                            y={y(reference) + 3.5}
                            className="num fill-muted-foreground text-[10px]"
                        >
                            {referenceLabel}
                        </text>
                    </g>
                ) : null}

                {drawn.length > 1 ? (
                    <polyline
                        points={drawn.map((p) => `${x(p.i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ')}
                        fill="none"
                        className="stroke-chart-series"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                ) : null}

                {drawn.map((p) => (
                    <g key={`${p.label}-${p.i}`}>
                        <title>{`${p.label} — ${p.rate.toFixed(0)}% de conversão`}</title>
                        <circle
                            cx={x(p.i)}
                            cy={y(p.rate)}
                            r={p.i === last?.i ? 5 : 3.5}
                            className="fill-chart-series stroke-card"
                            strokeWidth="1.5"
                        />
                    </g>
                ))}

                {points.map((p, i) => {
                    const every = Math.max(1, Math.ceil(points.length / 6))
                    if (i % every !== 0 && i !== points.length - 1) return null
                    return (
                        <text
                            key={`x-${p.label}-${i}`}
                            x={x(i)}
                            y={bottom + 16}
                            textAnchor="middle"
                            className="num fill-muted-foreground text-[10px]"
                        >
                            {p.label}
                        </text>
                    )
                })}
            </svg>
        </figure>
    )
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/**
 * Quando o paciente procura.
 *
 * A rampa é sequencial — um matiz, quatro passos, luminosidade monótona — e foi
 * validada contra o cartão nos dois modos. Célula sem nada fica em `muted`, que
 * é ausência, não o passo mais claro da escala.
 */
export function Heatmap({
    grid,
    slots,
    max,
}: {
    grid: number[][]
    slots: number[]
    max: number
}) {
    const stepOf = (value: number) => {
        if (value === 0 || max === 0) return 'bg-muted'
        const ratio = value / max
        if (ratio <= 0.25) return 'bg-chart-ramp-1'
        if (ratio <= 0.5) return 'bg-chart-ramp-2'
        if (ratio <= 0.75) return 'bg-chart-ramp-3'
        return 'bg-chart-ramp-4'
    }

    return (
        <figure className="m-0">
            <div className="overflow-x-auto">
                <div
                    className="grid min-w-[460px] gap-1 text-xs text-muted-foreground"
                    style={{
                        gridTemplateColumns: `2.25rem repeat(${slots.length}, minmax(0, 1fr))`,
                    }}
                >
                    <span />
                    {/* Um rótulo sim, um não: doze "0h 2h 4h…" lado a lado se
                        tocam antes de se lerem. */}
                    {slots.map((hour, i) => (
                        <span key={hour} className="num text-center text-[10px]">
                            {i % 2 === 0 ? `${hour}h` : ''}
                        </span>
                    ))}

                    {grid.map((row, dow) => (
                        <Row key={WEEKDAYS[dow]} day={WEEKDAYS[dow]} row={row} slots={slots} stepOf={stepOf} />
                    ))}
                </div>
            </div>

            <figcaption className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>nenhuma</span>
                <span aria-hidden="true" className="inline-block h-2.5 w-5 rounded-sm bg-muted" />
                <span aria-hidden="true" className="inline-block h-2.5 w-5 rounded-sm bg-chart-ramp-1" />
                <span aria-hidden="true" className="inline-block h-2.5 w-5 rounded-sm bg-chart-ramp-2" />
                <span aria-hidden="true" className="inline-block h-2.5 w-5 rounded-sm bg-chart-ramp-3" />
                <span aria-hidden="true" className="inline-block h-2.5 w-5 rounded-sm bg-chart-ramp-4" />
                <span className="num">{max} msg</span>
            </figcaption>
        </figure>
    )
}

function Row({
    day,
    row,
    slots,
    stepOf,
}: {
    day: string
    row: number[]
    slots: number[]
    stepOf: (value: number) => string
}) {
    return (
        <>
            <span className="flex items-center text-[11px]">{day}</span>
            {row.map((value, i) => (
                <span
                    key={`${day}-${slots[i]}`}
                    title={`${day}, ${slots[i]}h às ${slots[i] + 2}h — ${value} mensagem${value === 1 ? '' : 's'}`}
                    className={cn('h-6 rounded-sm', stepOf(value))}
                />
            ))}
        </>
    )
}
