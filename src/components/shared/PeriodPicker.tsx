'use client'

import { CalendarRange } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/utils'

/** Atalhos que cobrem o que se pergunta de verdade num funil. */
const PRESETS: { label: string; days: number }[] = [
    { label: 'Últimos 7 dias', days: 7 },
    { label: 'Últimos 30 dias', days: 30 },
    { label: 'Últimos 90 dias', days: 90 },
]

function iso(date: Date): string {
    return date.toISOString().slice(0, 10)
}

function short(value: string): string {
    const [y, m, d] = value.split('-')
    return y ? `${d}/${m}` : value
}

/**
 * O período como um controle só.
 *
 * Dois `<input type="date">` lado a lado custavam 270px e quebravam a barra em
 * três linhas numa janela de 1280 — e, piores que largos, eram mudos: um campo
 * vazio não diz se o recorte está ligado. Aqui o botão **mostra o recorte em
 * vigor** ("01/10 – 10/10" ou "Todo o período") e os campos moram dentro, com
 * os atalhos que cobrem a maioria das perguntas.
 */
export function PeriodPicker({
    from,
    to,
    onChange,
    className,
}: {
    from: string
    to: string
    onChange: (from: string, to: string) => void
    className?: string
}) {
    const now = useNow()
    const active = Boolean(from || to)

    const label = !active
        ? 'Todo o período'
        : from && to
            ? `${short(from)} – ${short(to)}`
            : from
                ? `desde ${short(from)}`
                : `até ${short(to)}`

    const applyPreset = (days: number) => {
        if (!now) return
        const end = new Date(now)
        const start = new Date(now)
        start.setDate(start.getDate() - days + 1)
        onChange(iso(start), iso(end))
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn('shrink-0 gap-1.5 font-normal', active && 'border-primary text-primary-subtle-foreground', className)}
                >
                    <CalendarRange className="size-3.5" />
                    <span className="num">{label}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[260px] space-y-3 p-3">
                <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                        <Label htmlFor="period-from" className="text-xs">De</Label>
                        <Input
                            id="period-from"
                            type="date"
                            value={from}
                            onChange={(e) => onChange(e.target.value, to)}
                            className="num h-8"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="period-to" className="text-xs">Até</Label>
                        <Input
                            id="period-to"
                            type="date"
                            value={to}
                            onChange={(e) => onChange(from, e.target.value)}
                            className="num h-8"
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => (
                        <Button
                            key={preset.days}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs font-normal"
                            onClick={() => applyPreset(preset.days)}
                        >
                            {preset.label}
                        </Button>
                    ))}
                    {active ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => onChange('', '')}
                        >
                            Limpar
                        </Button>
                    ) : null}
                </div>

                <p className="text-[11px] text-muted-foreground">
                    Negócio aberto entra pelo dia em que nasceu; ganho e perdido, pelo dia em que fecharam.
                </p>
            </PopoverContent>
        </Popover>
    )
}
