'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2, Trophy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@venn/ui/dialog'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@venn/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@venn/ui/select'
import { InlineField } from './InlineField'
import { DEFAULT_ENTITY_COLOR, PICKER_RAMP } from '../../lib/palette'
import { cn } from '@venn/ui/utils'
import { useVocab } from '../../hooks/useVocab'
import { comArtigo } from '../../lib/concordancia'

export interface ManagedStage {
    id: string
    name: string
    color: string
    order: number
    deals: unknown[]
    _count?: { deals: number }
    totalDeals?: number
    /** Dias sem retorno marcado até o sistema cobrar. `null` = não cobra. */
    followUpDays?: number | null
    /** Esta é a etapa de ganho do funil — para onde o aceite move o negócio. */
    isWon?: boolean
    /** Quem aperta enviar nesta fase: `off`, `draft` ou `send`. */
    autoSend?: string | null
}

/**
 * As fases do atendimento, num lugar só.
 *
 * Criar fase era um botão no fim do quadro — existia ali e sumia nas outras
 * duas visões; renomear e excluir moravam no menu de cada coluna, que o trilho
 * não tem. Com a jornada sendo a espinha desta tela, a jornada precisa de um
 * cadastro próprio, alcançável de qualquer visão.
 *
 * Excluir uma fase com negócios pede destino, em vez de recusar e mandar mover
 * um por um. E avisa o que se perde: as passagens por aquela fase vão com ela.
 */
export function StageManagerDialog({
    open,
    onOpenChange,
    stages,
    funilId,
    onChanged,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    stages: ManagedStage[]
    /**
     * Em qual funil a fase nova nasce. Sem ele a rota usa o padrão — que é o
     * certo para quem só tem um, e errado para quem está olhando o segundo.
     */
    funilId?: string | null
    onChanged: () => void
}) {
    const v = useVocab()
    const [busy, setBusy] = useState<string | null>(null)
    const [newName, setNewName] = useState('')
    const [newColor, setNewColor] = useState(PICKER_RAMP[0] ?? DEFAULT_ENTITY_COLOR)
    const [deleting, setDeleting] = useState<ManagedStage | null>(null)
    const [moveTo, setMoveTo] = useState('')
    /** Há WhatsApp conectado? Sem canal, a fase não tem como mandar nada. */
    const [canAutoSend, setCanAutoSend] = useState<boolean | null>(null)

    useEffect(() => {
        if (!open) return
        let cancelled = false
        fetch('/api/workspace/automations')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setCanAutoSend(Boolean(data?.canAutoSend))
            })
            .catch(() => {
                if (!cancelled) setCanAutoSend(false)
            })
        return () => { cancelled = true }
    }, [open])

    const sorted = [...stages].sort((a, b) => a.order - b.order)

    const patch = async (stage: ManagedStage, data: Record<string, unknown>) => {
        setBusy(stage.id)
        try {
            const res = await fetch(`/api/pipelines/${stage.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err.error || 'Não foi possível salvar a fase')
                return
            }
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    /** Troca a ordem com a vizinha: duas escritas, não uma renumeração geral. */
    const swap = async (index: number, direction: -1 | 1) => {
        const current = sorted[index]
        const neighbour = sorted[index + direction]
        if (!current || !neighbour) return
        setBusy(current.id)
        try {
            await Promise.all([
                fetch(`/api/pipelines/${current.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order: neighbour.order }),
                }),
                fetch(`/api/pipelines/${neighbour.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order: current.order }),
                }),
            ])
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    const create = async () => {
        const name = newName.trim()
        if (!name) return
        setBusy('new')
        try {
            const res = await fetch('/api/pipelines', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    color: newColor,
                    order: (sorted.at(-1)?.order ?? 0) + 1,
                    ...(funilId ? { funilId } : {}),
                }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err.error || 'Não foi possível criar a fase')
                return
            }
            setNewName('')
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    const confirmDelete = async () => {
        if (!deleting) return
        const count = dealCount(deleting)
        if (count > 0 && !moveTo) {
            toast.error('Escolha a fase que recebe os negócios')
            return
        }
        setBusy(deleting.id)
        try {
            const query = count > 0 ? `?moveTo=${moveTo}` : ''
            const res = await fetch(`/api/pipelines/${deleting.id}${query}`, { method: 'DELETE' })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err.error || 'Não foi possível excluir a fase')
                return
            }
            toast.success('Fase excluída')
            setDeleting(null)
            setMoveTo('')
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setDeleting(null) }}>
            {/* A largura acompanhou os controles.
                A fase ganhou prazo e modo de envio sem o diálogo crescer, e os
                dois últimos campos saíam pela borda. `max-w-3xl` cabe a linha
                inteira em 1280, e abaixo disso a linha quebra em duas em vez de
                cortar. */}
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Fases do atendimento</DialogTitle>
                    <DialogDescription>
                        A jornada {comArtigo(v, 'organizacao', 'este')}. Vale para o funil, para a lista e para o painel {comArtigo(v, 'pessoa', 'de')}.
                    </DialogDescription>
                </DialogHeader>

                {deleting ? (
                    <div className="space-y-3">
                        <p className="text-sm">
                            Excluir <strong>{deleting.name}</strong>?
                        </p>
                        {dealCount(deleting) > 0 ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="stage-move" className="text-xs">
                                    {dealCount(deleting)} {dealCount(deleting) === 1 ? 'negócio está' : 'negócios estão'} nesta fase. Mover para
                                </Label>
                                <Select value={moveTo} onValueChange={setMoveTo}>
                                    <SelectTrigger id="stage-move" className="w-full">
                                        <SelectValue placeholder="Escolha a fase de destino" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {sorted.filter((s) => s.id !== deleting.id).map((s) => (
                                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                            As passagens por esta fase saem da jornada junto com ela — inclusive de
                            negócios que já seguiram adiante. Os negócios não são apagados.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => { setDeleting(null); setMoveTo('') }}>
                                Cancelar
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => void confirmDelete()}
                                disabled={busy === deleting.id}
                                className="gap-1.5"
                            >
                                {busy === deleting.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                                Excluir fase
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {/* Cabeçalho da lista: sem ele, dois campos numéricos
                            lado a lado não dizem o que são. */}
                        <div className="hidden items-center gap-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:flex">
                            <span className="w-5" />
                            <span className="flex-1">Fase</span>
                            <span className="w-[72px] text-center">Cobrar em</span>
                            <span className="w-[116px]">Envio</span>
                            <span className="w-[60px]" />
                        </div>

                        {sorted.map((stage, index) => (
                            <div
                                key={stage.id}
                                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-2 sm:flex-nowrap"
                            >
                                <ColorPick
                                    color={stage.color}
                                    onPick={(color) => void patch(stage, { color })}
                                />
                                <InlineField
                                    value={stage.name}
                                    onCommit={(name) => void patch(stage, { name })}
                                    ariaLabel={`Nome da fase ${stage.name}`}
                                    bare
                                    className="min-w-[140px] flex-1"
                                />

                                {/* O prazo da fase: é ele que faz a tarefa de
                                    retomada nascer sozinha. Vazio significa "esta
                                    fase não cobra" — e é o padrão, para ligar a
                                    automação ser decisão da clínica. */}
                                <Input
                                    type="number"
                                    min={0}
                                    max={365}
                                    value={stage.followUpDays ?? ''}
                                    placeholder="—"
                                    aria-label={`Cobrar retomada em quantos dias na fase ${stage.name}`}
                                    onChange={(e) => {
                                        const raw = e.target.value
                                        void patch(stage, { followUpDays: raw === '' ? null : Number(raw) })
                                    }}
                                    className="num h-8 w-[72px] shrink-0 px-2 text-center text-xs"
                                />

                                {/* A etapa de GANHO: para onde o aceite de uma
                                    proposta move o negócio.

                                    Existe porque posição não é significado. O
                                    aceite caía na última etapa por ordem, e as
                                    etapas padrão terminam em retrabalho — então
                                    aceitar um documento mandava o negócio para
                                    lá. Nenhuma marcada mantém a queda para a
                                    última, que é o que funil antigo já fazia. */}
                                <Button
                                    type="button"
                                    variant={stage.isWon ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 shrink-0 px-2"
                                    aria-pressed={Boolean(stage.isWon)}
                                    aria-label={`Marcar ${stage.name} como a etapa de ganho`}
                                    title={
                                        stage.isWon
                                            ? 'O aceite de uma proposta move o negócio para cá'
                                            : 'Marcar como a etapa de ganho deste funil'
                                    }
                                    onClick={() => void patch(stage, { isWon: !stage.isWon })}
                                >
                                    <Trophy className="size-3.5" aria-hidden />
                                    <span className="sr-only">Etapa de ganho</span>
                                </Button>

                                {/* Quem aperta enviar nesta fase. Três estados, e
                                    o do meio é o que evita soltar o sistema sem a
                                    clínica ter lido uma semana do que ele diria. */}
                                <Select
                                    value={stage.autoSend ?? 'off'}
                                    disabled={!canAutoSend}
                                    onValueChange={(v) => void patch(stage, { autoSend: v })}
                                >
                                    <SelectTrigger
                                        size="sm"
                                        className="w-[116px] shrink-0"
                                        aria-label={`Envio automático na fase ${stage.name}`}
                                        title={canAutoSend === false ? 'Sem WhatsApp conectado' : undefined}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="off">Só tarefa</SelectItem>
                                        <SelectItem value="draft">Ensaio</SelectItem>
                                        <SelectItem value="send">Enviar sozinho</SelectItem>
                                    </SelectContent>
                                </Select>

                                <div className="flex w-[60px] shrink-0 items-center justify-end">
                                    <div className="flex flex-col">
                                        <button
                                            type="button"
                                            onClick={() => void swap(index, -1)}
                                            disabled={index === 0 || busy === stage.id}
                                            aria-label="Subir"
                                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                                        >
                                            <ChevronUp className="size-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void swap(index, 1)}
                                            disabled={index === sorted.length - 1 || busy === stage.id}
                                            aria-label="Descer"
                                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                                        >
                                            <ChevronDown className="size-3.5" />
                                        </button>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => { setDeleting(stage); setMoveTo('') }}
                                        aria-label={`Excluir fase ${stage.name}`}
                                        disabled={sorted.length <= 1}
                                        title={sorted.length <= 1 ? 'O funil precisa de pelo menos uma fase' : undefined}
                                    >
                                        <Trash2 className="size-3.5 text-muted-foreground" />
                                    </Button>
                                </div>
                            </div>
                        ))}

                        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 sm:flex-nowrap">
                            <ColorPick color={newColor} onPick={setNewColor} />
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Nome da nova fase"
                                aria-label="Nome da nova fase"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault()
                                        void create()
                                    }
                                }}
                            />
                            <Button
                                size="sm"
                                onClick={() => void create()}
                                disabled={busy === 'new' || !newName.trim()}
                                className="shrink-0 gap-1.5"
                            >
                                {busy === 'new' ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                                Acrescentar
                            </Button>
                        </div>

                        <p className="pt-1 text-xs text-muted-foreground">
                            <strong>Só tarefa</strong> cobra pelo painel, sem falar com {comArtigo(v, 'pessoa')}.
                            <strong> Ensaio</strong> escreve a mensagem e deixa para alguém aprovar —
                            passe por ele antes de soltar. <strong>Enviar sozinho</strong> manda a
                            quem tem WhatsApp, em horário comercial, no máximo duas vezes por
                            {v.pessoa} e nunca em conversa que alguém está atendendo.
                            {canAutoSend === false ? ' Sem WhatsApp conectado, só a tarefa funciona.' : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            A coluna <strong>d</strong> é o prazo: passados tantos dias sem nenhum
                            retorno marcado, o sistema cria sozinho a tarefa “Retomar contato” para
                            o responsável. Vazio, a fase não cobra nada.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            A <strong>Finalização</strong> fecha toda jornada e não é uma fase daqui —
                            ganho e perdido se registram no painel, e os motivos têm a sua própria lista.
                        </p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

/**
 * Quantos negócios a fase tem **de verdade** — fechados e fora do período
 * inclusive. É o número que decide se excluir a fase exige um destino, e aqui
 * o recorte da tela não vale: o negócio ganho em março também precisa de um
 * lugar para onde ir.
 */
function dealCount(stage: ManagedStage): number {
    return stage.totalDeals ?? stage._count?.deals ?? stage.deals.length
}

/** A cor da fase, escolhida da rampa da marca — nunca um campo hex livre. */
function ColorPick({ color, onPick }: { color: string; onPick: (color: string) => void }) {
    const [open, setOpen] = useState(false)
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="Cor da fase"
                    className="size-5 shrink-0 rounded ring-offset-2 ring-offset-popover hover:ring-2 hover:ring-border"
                    style={{ backgroundColor: color }}
                />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2">
                <div className="flex gap-1.5" role="radiogroup" aria-label="Cor da fase">
                    {PICKER_RAMP.map((hex) => (
                        <button
                            key={hex}
                            type="button"
                            role="radio"
                            aria-checked={color === hex}
                            aria-label={`Cor ${hex}`}
                            onClick={() => { onPick(hex); setOpen(false) }}
                            className={cn(
                                'size-6 rounded-full ring-offset-2 ring-offset-popover',
                                color === hex ? 'ring-2 ring-ring' : 'hover:ring-2 hover:ring-border'
                            )}
                            style={{ backgroundColor: hex }}
                        />
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    )
}
