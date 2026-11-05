'use client'

import { CalendarRange } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useNow } from '@/hooks/useNow'
import { useFusoDaUnidade } from '@/hooks/useUnidades'
import { PERIOD_PRESETS, matchPreset, periodRange, type PeriodPresetId } from '@/lib/period'
import { cn } from '@/lib/utils'

function short(value: string): string {
    const [y, m, d] = value.split('-')
    return y ? `${d}/${m}` : value
}

/**
 * O período como um controle só — o mesmo em toda tela que filtra por data.
 *
 * Dois `<input type="date">` lado a lado custavam 270px e quebravam a barra em
 * três linhas numa janela de 1280 — e, piores que largos, eram mudos: um campo
 * vazio não diz se o recorte está ligado. Aqui o botão **mostra o recorte em
 * vigor** ("Este mês", "01/10 – 10/10" ou "Todo o período") e os campos moram
 * dentro, com os seis atalhos do produto.
 *
 * O rótulo prefere o nome do atalho ao par de datas: quem escolheu "Este mês"
 * reconhece "Este mês" de volta, não "01/10 – 31/10".
 */
export function PeriodPicker({
    from,
    to,
    onChange,
    presetHint,
    className,
}: {
    from: string
    to: string
    onChange: (from: string, to: string) => void
    /**
     * O atalho que este recorte é, para quem já sabe — a tela que resolveu o
     * padrão no servidor, ou o efeito que o escolheu ao montar.
     *
     * Existe por causa de um piscar: `useNow()` devolve `0` até o relógio
     * entrar, e sem "agora" não dá para saber que 01/10–31/10 é *este* mês. O
     * botão nascia "01/10 – 31/10" e virava "Este mês" um quadro depois. A
     * dica vale só enquanto o relógio não respondeu; a partir daí quem manda é
     * a conta, senão a dica congelaria o rótulo numa escolha velha.
     */
    presetHint?: PeriodPresetId | null
    className?: string
}) {
    const now = useNow()
    // "Hoje", "esta semana" e "este mês" no calendário da unidade — o mesmo que
    // o servidor usa para responder. Ver `lib/period.ts`.
    const fuso = useFusoDaUnidade()
    const active = Boolean(from || to)
    const preset = now ? matchPreset(from, to, now, fuso) : (presetHint ?? null)

    const label = !active
        ? 'Todo o período'
        : preset
            ? PERIOD_PRESETS.find((p) => p.id === preset)!.label
            : from && to
                ? `${short(from)} – ${short(to)}`
                : from
                    ? `desde ${short(from)}`
                    : `até ${short(to)}`

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
            <PopoverContent align="end" className="w-[268px] p-3">
                <PeriodFields from={from} to={to} onChange={onChange} />
            </PopoverContent>
        </Popover>
    )
}

/**
 * Os campos e os atalhos do período, sem o botão em volta.
 *
 * O `PeriodPicker` é botão + este miolo. A pílula de filtro das telas de índice
 * já é o botão — então ela abre só o miolo, e o rótulo "Este mês" passa a viver
 * na pílula, onde os outros filtros também mostram o próprio valor.
 */
export function PeriodFields({
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
    const fuso = useFusoDaUnidade()
    const active = Boolean(from || to)
    const preset = matchPreset(from, to, now, fuso)

    const applyPreset = (id: PeriodPresetId) => {
        if (!now) return
        const range = periodRange(id, now, fuso)
        onChange(range.from, range.to)
    }

    return (
    <div className={cn('w-[244px] space-y-3', className)}>
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

            {/* Duas colunas: os seis atalhos em linha única viravam quatro
                linhas irregulares, e "Últimos 30 dias" sozinho numa delas
                lê como sobra, não como opção. */}
            <div className="grid grid-cols-2 gap-1.5">
                {PERIOD_PRESETS.map((item) => (
                    <Button
                        key={item.id}
                        variant={preset === item.id ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-7 justify-start text-xs font-normal"
                        onClick={() => applyPreset(item.id)}
                    >
                        {item.label}
                    </Button>
                ))}
            </div>

            {active ? (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-full text-xs"
                    onClick={() => onChange('', '')}
                >
                    Todo o período
                </Button>
            ) : null}
    </div>
    )
}
