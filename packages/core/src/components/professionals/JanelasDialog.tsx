'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { RecordDialog } from '../shared/RecordDialog'
import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Switch } from '@venn/ui/switch'
import { Checkbox } from '@venn/ui/checkbox'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@venn/ui/tooltip'

/**
 * A grade de horários de um especialista.
 *
 * **Uma lista só, e a permissão do agente é um campo dela.** A tentação era
 * separar "horário de trabalho" de "janela liberada para a IA"; aí os dois
 * divergem, alguém muda o expediente, esquece a janela, e o agente marca num
 * horário em que a doutora não está.
 *
 * A gravação manda a grade **inteira** e substitui a anterior — quem edita mexe
 * numa grade, não em registros, e assim ela nunca fica pela metade.
 */

export const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

interface Procedimento {
    id: string
    name: string
    durationMinutes: number | null
}

interface Janela {
    weekday: number
    startTime: string
    endTime: string
    agentCanBook: boolean
    procedureIds: string[]
}

interface Especialista {
    id: string
    name: string
}

export function JanelasDialog({
    open,
    onOpenChange,
    professionalId,
    onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Quando vem nulo, o diálogo pede o especialista — é a entrada pela Agenda. */
    professionalId?: string | null
    onSaved?: () => void
}) {
    const [escolhido, setEscolhido] = useState<string | null>(professionalId ?? null)
    const [especialistas, setEspecialistas] = useState<Especialista[]>([])
    const [procedimentos, setProcedimentos] = useState<Procedimento[]>([])
    const [janelas, setJanelas] = useState<Janela[]>([])
    const [carregando, setCarregando] = useState(false)
    const [salvando, setSalvando] = useState(false)

    useEffect(() => {
        if (open) setEscolhido(professionalId ?? null)
    }, [open, professionalId])

    // A lista de especialistas só é necessária quando o diálogo precisa perguntar.
    useEffect(() => {
        if (!open || professionalId) return
        fetch('/api/professionals')
            .then((r) => (r.ok ? r.json() : []))
            .then(setEspecialistas)
            .catch(() => undefined)
    }, [open, professionalId])

    useEffect(() => {
        if (!open) return
        fetch('/api/products?schedulable=true&limit=200')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setProcedimentos(d?.data ?? d ?? []))
            .catch(() => undefined)
    }, [open])

    const carregar = useCallback(async () => {
        if (!escolhido) return
        setCarregando(true)
        try {
            const res = await fetch(`/api/professionals/${escolhido}`)
            if (!res.ok) return
            const data = await res.json()
            setJanelas(
                (data.windows ?? []).map((w: { weekday: number; startTime: string; endTime: string; agentCanBook: boolean; services: { id: string }[] }) => ({
                    weekday: w.weekday,
                    startTime: w.startTime,
                    endTime: w.endTime,
                    agentCanBook: w.agentCanBook,
                    procedureIds: w.services.map((p) => p.id),
                }))
            )
        } finally {
            setCarregando(false)
        }
    }, [escolhido])

    useEffect(() => {
        if (open && escolhido) void carregar()
        if (!escolhido) setJanelas([])
    }, [open, escolhido, carregar])

    const alterar = (i: number, patch: Partial<Janela>) =>
        setJanelas((prev) => prev.map((j, idx) => (idx === i ? { ...j, ...patch } : j)))

    const adicionar = () =>
        setJanelas((prev) => [
            ...prev,
            { weekday: 1, startTime: '09:00', endTime: '12:00', agentCanBook: false, procedureIds: [] },
        ])

    const salvar = async () => {
        if (!escolhido) return
        setSalvando(true)
        try {
            const res = await fetch(`/api/professionals/${escolhido}/windows`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ windows: janelas }),
            })
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(corpo.error ?? 'Não foi possível salvar as janelas')
                return
            }
            toast.success(
                janelas.length === 0
                    ? 'Grade de horários esvaziada'
                    : `${janelas.length} janela(s) salva(s)`
            )
            onSaved?.()
            onOpenChange(false)
        } finally {
            setSalvando(false)
        }
    }

    const semProcedimentos = procedimentos.length === 0

    /**
     * A moldura é a do sistema, não um `Dialog` solto.
     *
     * Esta tela nasceu com `DialogContent` próprio — outra largura, sem o
     * rodapé preso, sem a legenda de Esc · ⌘↵ — e por isso lia como uma tela
     * de outro produto. O Andre apontou em 2026-10-20. `RecordDialog` traz a
     * geometria fechada na Tela 01 (DESIGN.md §5): cabeçalho e rodapé presos,
     * só o conteúdo rola, e o envio com verbo e objeto.
     */
    return (
        <RecordDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Janelas de atendimento"
            description="As faixas em que o especialista atende. Marque quais o agente de IA pode preencher sozinho — e quais procedimentos cabem em cada uma."
            size="wide"
            hideAgain
            submitLabel="Salvar grade"
            submitDisabled={!escolhido}
            submitting={salvando}
            onSubmit={() => void salvar()}
        >
            <div className="col-span-2 flex flex-col gap-3">

                {!professionalId ? (
                    <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs text-muted-foreground">Especialista:</span>
                        <Select value={escolhido ?? ''} onValueChange={setEscolhido}>
                            <SelectTrigger className="h-9 flex-1">
                                <SelectValue placeholder="Escolha de quem é a grade" />
                            </SelectTrigger>
                            <SelectContent>
                                {especialistas.map((e) => (
                                    <SelectItem key={e.id} value={e.id}>
                                        {e.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}

                {!escolhido ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                        Escolha um especialista para ver a grade dele.
                    </p>
                ) : carregando ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Carregando a grade…
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {janelas.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                                Nenhuma faixa ainda. Sem janela, este especialista não aparece como
                                disponível em lugar nenhum.
                            </p>
                        ) : null}

                        {janelas.map((j, i) => (
                            <div key={i} className="rounded-lg border border-border p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Select
                                        value={String(j.weekday)}
                                        onValueChange={(v) => alterar(i, { weekday: Number(v) })}
                                    >
                                        <SelectTrigger className="h-8 w-[7.5rem] text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {DIAS.map((d, idx) => (
                                                <SelectItem key={d} value={String(idx)}>
                                                    {d}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>

                                    <Input
                                        type="time"
                                        value={j.startTime}
                                        onChange={(e) => alterar(i, { startTime: e.target.value })}
                                        className="h-8 w-[6.5rem] text-xs"
                                        aria-label="Começa às"
                                    />
                                    <span className="text-xs text-muted-foreground">até</span>
                                    <Input
                                        type="time"
                                        value={j.endTime}
                                        onChange={(e) => alterar(i, { endTime: e.target.value })}
                                        className="h-8 w-[6.5rem] text-xs"
                                        aria-label="Termina às"
                                    />

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="ml-auto flex items-center gap-2">
                                                <span className="text-xs text-muted-foreground">
                                                    O agente pode marcar
                                                </span>
                                                <Switch
                                                    checked={j.agentCanBook}
                                                    disabled={semProcedimentos}
                                                    onCheckedChange={(v) => alterar(i, { agentCanBook: v })}
                                                    aria-label="O agente de IA pode marcar nesta janela"
                                                />
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {semProcedimentos
                                                ? 'Cadastre um Item com categoria "Procedimento" e duração antes de liberar o agente.'
                                                : 'Ligado, o agente marca sozinho aqui — só os procedimentos marcados abaixo.'}
                                        </TooltipContent>
                                    </Tooltip>

                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Remover esta janela"
                                        onClick={() => setJanelas((prev) => prev.filter((_, idx) => idx !== i))}
                                    >
                                        <Trash2 className="size-4 text-destructive-subtle-foreground" />
                                    </Button>
                                </div>

                                {/* A lista de procedimentos só importa quando o agente
                                    pode marcar: para a recepção, a janela é só horário. */}
                                {j.agentCanBook ? (
                                    <div className="mt-3 border-t border-border pt-3">
                                        <p className="mb-2 text-xs text-muted-foreground">
                                            O agente pode marcar, nesta janela:
                                        </p>
                                        {semProcedimentos ? (
                                            <p className="text-xs text-warning-subtle-foreground">
                                                Nenhum procedimento cadastrado ainda.
                                            </p>
                                        ) : (
                                            <div className="flex flex-wrap gap-x-4 gap-y-2">
                                                {procedimentos.map((p) => {
                                                    const marcado = j.procedureIds.includes(p.id)
                                                    return (
                                                        <label
                                                            key={p.id}
                                                            className="flex cursor-pointer items-center gap-2 text-xs"
                                                        >
                                                            <Checkbox
                                                                checked={marcado}
                                                                onCheckedChange={(v) =>
                                                                    alterar(i, {
                                                                        procedureIds: v
                                                                            ? [...j.procedureIds, p.id]
                                                                            : j.procedureIds.filter((x) => x !== p.id),
                                                                    })
                                                                }
                                                            />
                                                            <span>
                                                                {p.name}
                                                                {p.durationMinutes ? (
                                                                    <span className="num text-muted-foreground">
                                                                        {' · '}
                                                                        {p.durationMinutes} min
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-warning-subtle-foreground">
                                                                        {' · sem duração'}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        )}
                                        {j.procedureIds.length === 0 ? (
                                            <p className="mt-2 text-xs text-warning-subtle-foreground">
                                                Nenhum marcado: o agente não vai marcar nada aqui.
                                            </p>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        ))}

                        <Button variant="outline" size="sm" className="self-start" onClick={adicionar}>
                            <Plus className="size-4" />
                            Adicionar faixa
                        </Button>
                    </div>
                )}

            </div>
        </RecordDialog>
    )
}
