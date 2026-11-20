'use client'

import { useState } from 'react'
import { Loader2, Plus, Star, Trash2 } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@venn/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@venn/ui/tooltip'
import { cn } from '@venn/ui/utils'
import { InlineField } from './InlineField'

export interface FunilItem {
    id: string
    name: string
    isDefault: boolean
    /** Quantas fases tem — zero é funil que ainda não serve para nada. */
    fases: number
    /** Quantos negócios estão nele, abertos e fechados — decide se excluir pede destino. */
    negocios: number
}

/**
 * Os funis de venda da unidade, num lugar só.
 *
 * Irmão do `StageManagerDialog`: aquele cuida das fases **de um** funil, este
 * cuida de **quais** funis existem. Separados porque são duas perguntas que se
 * fazem em momentos diferentes — fase se ajusta toda semana, funil novo se cria
 * uma vez por produto.
 *
 * **O padrão é uma estrela**, e só uma. É o funil do atendimento inteiro —
 * onde a primeira mensagem cria negócio, onde o agente move, o que a caixa de
 * entrada pinta —, então trocar é ato explícito, com a consequência escrita ao
 * lado. O padrão não se exclui: a tela diz por quê em vez de oferecer o botão.
 *
 * Excluir um funil com negócios pede destino, como a fase: eles vão para a
 * primeira fase do funil escolhido, com a passagem registrada.
 */
export function FunisDialog({
    open,
    onOpenChange,
    funis,
    funilAtualId,
    onChanged,
    onSelect,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    funis: FunilItem[]
    /** O funil que a tela está mostrando — para o diálogo apontar. */
    funilAtualId: string | null
    /** Relê a lista depois de qualquer gravação. */
    onChanged: () => void
    /** A tela passa a mostrar este funil (criado agora, ou o destino de uma exclusão). */
    onSelect: (funilId: string) => void
}) {
    const [busy, setBusy] = useState<string | null>(null)
    const [newName, setNewName] = useState('')
    const [deleting, setDeleting] = useState<FunilItem | null>(null)
    const [moveTo, setMoveTo] = useState('')

    const patch = async (funil: FunilItem, data: Record<string, unknown>) => {
        setBusy(funil.id)
        try {
            const res = await fetch(`/api/pipelines/funis/${funil.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err.error || 'Não foi possível salvar o funil')
                return
            }
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
            const res = await fetch('/api/pipelines/funis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            })
            const dados = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(dados.error || 'Não foi possível criar o funil')
                return
            }
            setNewName('')
            toast.success('Funil criado')
            onChanged()
            // Quem cria um funil quer vê-lo: a tela troca para ele.
            if (typeof dados.id === 'string') onSelect(dados.id)
        } finally {
            setBusy(null)
        }
    }

    const confirmDelete = async () => {
        if (!deleting) return
        if (deleting.negocios > 0 && !moveTo) {
            toast.error('Escolha o funil que recebe os negócios')
            return
        }
        setBusy(deleting.id)
        try {
            const query = deleting.negocios > 0 ? `?moveTo=${moveTo}` : ''
            const res = await fetch(`/api/pipelines/funis/${deleting.id}${query}`, { method: 'DELETE' })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err.error || 'Não foi possível excluir o funil')
                return
            }
            toast.success('Funil excluído')
            const apagado = deleting.id
            setDeleting(null)
            setMoveTo('')
            onChanged()
            // A tela estava mostrando o que saiu: passa para quem ficou.
            if (funilAtualId === apagado) {
                const destino = moveTo || funis.find((f) => f.id !== apagado)?.id
                if (destino) onSelect(destino)
            }
        } finally {
            setBusy(null)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) { setDeleting(null); setMoveTo('') } }}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Funis de venda</DialogTitle>
                    <DialogDescription>
                        Cada funil tem as suas fases. O marcado com a estrela é o do atendimento:
                        é nele que a primeira mensagem cria o negócio e que o agente trabalha.
                    </DialogDescription>
                </DialogHeader>

                {deleting ? (
                    <div className="space-y-3">
                        <p className="text-sm">
                            Excluir <strong>{deleting.name}</strong>?
                        </p>
                        {deleting.negocios > 0 ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="funil-move" className="text-xs">
                                    {deleting.negocios} {deleting.negocios === 1 ? 'negócio está' : 'negócios estão'} neste funil. Mover para
                                </Label>
                                <Select value={moveTo} onValueChange={setMoveTo}>
                                    <SelectTrigger id="funil-move" className="w-full">
                                        <SelectValue placeholder="Escolha o funil de destino" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {funis.filter((f) => f.id !== deleting.id).map((f) => (
                                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Eles entram na primeira fase do funil escolhido, com a passagem registrada
                                    na jornada.
                                </p>
                            </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                            As fases deste funil saem com ele, e as passagens por elas também. Os
                            negócios não são apagados.
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
                                Excluir funil
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {funis.map((funil) => (
                            <div
                                key={funil.id}
                                className={cn(
                                    'flex items-center gap-2 rounded-md border border-border px-2 py-2',
                                    funil.id === funilAtualId && 'border-primary/50'
                                )}
                            >
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={funil.isDefault}
                                            aria-label={funil.isDefault ? 'Funil padrão do atendimento' : `Tornar ${funil.name} o funil padrão`}
                                            disabled={funil.isDefault || busy === funil.id}
                                            onClick={() => void patch(funil, { isDefault: true })}
                                            className={cn(
                                                'shrink-0 rounded p-0.5',
                                                funil.isDefault ? 'text-warning' : 'text-muted-foreground/50 hover:text-foreground'
                                            )}
                                        >
                                            <Star className={cn('size-4', funil.isDefault && 'fill-current')} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {funil.isDefault
                                            ? 'Padrão: o atendimento cria e move negócios aqui'
                                            : 'Tornar padrão — o atendimento passa a usar este funil'}
                                    </TooltipContent>
                                </Tooltip>

                                <InlineField
                                    value={funil.name}
                                    onCommit={(name) => { if (name.trim() && name.trim() !== funil.name) void patch(funil, { name: name.trim() }) }}
                                    ariaLabel={`Nome do funil ${funil.name}`}
                                    bare
                                    className="min-w-[140px] flex-1"
                                />

                                <span className="num shrink-0 text-xs text-muted-foreground">
                                    {funil.fases} {funil.fases === 1 ? 'fase' : 'fases'} · {funil.negocios} {funil.negocios === 1 ? 'negócio' : 'negócios'}
                                </span>

                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => { setDeleting(funil); setMoveTo('') }}
                                    aria-label={`Excluir funil ${funil.name}`}
                                    disabled={funil.isDefault || busy === funil.id}
                                    title={funil.isDefault ? 'O funil padrão não se exclui. Marque outro como padrão antes.' : undefined}
                                >
                                    <Trash2 className="size-3.5 text-muted-foreground" />
                                </Button>
                            </div>
                        ))}

                        <div className="flex items-center gap-2 border-t border-border pt-3">
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Nome do novo funil"
                                aria-label="Nome do novo funil"
                                maxLength={40}
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
                                Criar funil
                            </Button>
                        </div>

                        <p className="pt-1 text-xs text-muted-foreground">
                            O funil novo nasce com as fases padrão — ajuste-as em <strong>Fases</strong>.
                            Um mesmo contato pode ter um negócio aberto em cada funil.
                        </p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
