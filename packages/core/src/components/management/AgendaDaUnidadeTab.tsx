'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarOff, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Switch } from '@venn/ui/switch'
import { Badge } from '@venn/ui/badge'
import { BandLayout, SettingsBand, SettingsRow } from '../shared/TabsFrame'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { EmptyState } from '../shared/EmptyState'
import { FormField } from '../shared/FormField'
import { RecordDialog } from '../shared/RecordDialog'
import { usePermissions } from '../../hooks/usePermissions'

/**
 * O calendário da clínica: quando ela não atende.
 *
 * Vale para **todos** os especialistas e ganha das janelas deles — é a camada
 * que sobrepõe a agenda.
 *
 * Duas listas, e a diferença importa. Os **feriados nacionais** já vêm: a lista
 * é calculada (os móveis andam com a Páscoa) e cada um bloqueia por padrão, com
 * um interruptor para a clínica que atende naquele dia. Os **fechamentos** são
 * dela — recesso, congresso, dedetização.
 *
 * O padrão "bloqueia" é deliberado e é o oposto do Google Calendar, onde o
 * feriado chega como evento "Livre" e os agendamentos passam por cima. Numa
 * clínica, isso é um paciente na porta de uma porta fechada.
 */

interface Feriado {
    key: string
    name: string
    date: string
    movel: boolean
    blocks: boolean
    decidido: boolean
}

interface Fechamento {
    id: string
    name: string
    startsOn: string
    endsOn: string
    allDay: boolean
    startTime: string | null
    endTime: string | null
    blocks: boolean
}

function porExtenso(iso: string): string {
    const [a, m, d] = iso.split('-').map(Number)
    return new Intl.DateTimeFormat('pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
    }).format(new Date(Date.UTC(a, m - 1, d, 12)))
}

const VAZIO = {
    name: '',
    startsOn: '',
    endsOn: '',
    allDay: true,
    startTime: '09:00',
    endTime: '18:00',
    blocks: true,
}

export function AgendaDaUnidadeTab() {
    const { canEdit } = usePermissions()
    const [ano, setAno] = useState(new Date().getFullYear())
    const [feriados, setFeriados] = useState<Feriado[]>([])
    const [fechamentos, setFechamentos] = useState<Fechamento[]>([])
    const [carregando, setCarregando] = useState(true)

    const [dialogo, setDialogo] = useState(false)
    const [form, setForm] = useState(VAZIO)
    const [erro, setErro] = useState<string | null>(null)
    const [salvando, setSalvando] = useState(false)
    const [excluindo, setExcluindo] = useState<Fechamento | null>(null)

    const carregar = useCallback(async () => {
        setCarregando(true)
        try {
            const res = await fetch(`/api/schedule-exceptions?year=${ano}`)
            if (!res.ok) return
            const d = await res.json()
            setFeriados(d.feriados ?? [])
            setFechamentos(d.fechamentos ?? [])
        } finally {
            setCarregando(false)
        }
    }, [ano])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const decidirFeriado = async (f: Feriado, bloqueia: boolean) => {
        // Otimista: o interruptor responde na hora, e o servidor confirma.
        setFeriados((prev) =>
            prev.map((x) => (x.key === f.key ? { ...x, blocks: bloqueia, decidido: true } : x))
        )
        const res = await fetch('/api/schedule-exceptions', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ holidayKey: f.key, blocks: bloqueia }),
        })
        if (!res.ok) {
            toast.error('Não foi possível salvar')
            await carregar()
        }
    }

    const criar = async () => {
        if (!form.name.trim()) {
            setErro('Dê um nome ao fechamento.')
            return
        }
        if (!form.startsOn) {
            setErro('Informe a data.')
            return
        }
        setSalvando(true)
        try {
            const res = await fetch('/api/schedule-exceptions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    endsOn: form.endsOn || form.startsOn,
                    startTime: form.allDay ? null : form.startTime,
                    endTime: form.allDay ? null : form.endTime,
                }),
            })
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                setErro(corpo.error ?? 'Não foi possível salvar')
                return
            }
            toast.success('Fechamento criado')
            setDialogo(false)
            setForm(VAZIO)
            await carregar()
        } finally {
            setSalvando(false)
        }
    }

    const excluir = async () => {
        if (!excluindo) return
        const res = await fetch(`/api/schedule-exceptions/${excluindo.id}`, { method: 'DELETE' })
        if (!res.ok) {
            toast.error('Não foi possível excluir')
            return
        }
        toast.success('Fechamento removido')
        await carregar()
    }

    return (
        /*
         * Guia sangrada com rodapé preso, como manda o DESIGN.md §5 (Tela 03):
         * "na Conta, todas as guias são sangradas — a tela de guias não rola".
         * Estava no molde de "guia de ajustes", que é o padrão de **fora** da
         * Conta: cartões brancos sobre fundo tingido num contêiner que rola.
         *
         * As duas faixas dividem a altura em partes iguais e cada lista rola
         * por dentro. Equilibra a tela com qualquer quantidade de datas — são
         * treze feriados nacionais e os fechamentos crescem sem teto — e não
         * depende de contar linhas: janela baixa mostra menos em cada metade,
         * janela alta mostra mais, e nenhuma das duas some.
         */
        <BandLayout
            footer={
                canEdit ? (
                    <Button onClick={() => { setForm(VAZIO); setErro(null); setDialogo(true) }}>
                        <Plus className="size-4" />
                        Novo fechamento
                    </Button>
                ) : undefined
            }
        >
          <div className="flex h-full min-h-0 flex-col">
            <SettingsBand
                className="flex min-h-0 flex-1 flex-col"
                title="Feriados nacionais"
                description="Já vêm prontos e bloqueiam a agenda de todos os especialistas. Desligue os que a clínica atende."
                aside={
                    <span className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setAno((a) => a - 1)}>
                            ‹
                        </Button>
                        <span className="num text-xs font-semibold">{ano}</span>
                        <Button variant="ghost" size="sm" onClick={() => setAno((a) => a + 1)}>
                            ›
                        </Button>
                    </span>
                }
            >
                {carregando ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> Carregando…
                    </div>
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                      <div className="flex flex-col divide-y divide-border">
                        {feriados.map((f) => (
                            <div key={f.key} className="py-2.5 first:pt-0 last:pb-0">
                                <SettingsRow
                                    title={
                                        <span className="flex items-center gap-2">
                                            {f.name}
                                            {/* Dizer que é móvel explica por que a data
                                                muda de um ano para o outro. */}
                                            {f.movel ? <Badge variant="outline">data móvel</Badge> : null}
                                        </span>
                                    }
                                    description={porExtenso(f.date)}
                                    action={
                                        <span className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">
                                                {f.blocks ? 'Fechado' : 'Atendemos'}
                                            </span>
                                            <Switch
                                                checked={!f.blocks}
                                                disabled={!canEdit}
                                                aria-label={`A clínica atende no ${f.name}`}
                                                onCheckedChange={(v) => void decidirFeriado(f, !v)}
                                            />
                                        </span>
                                    }
                                />
                            </div>
                        ))}
                      </div>
                    </div>
                )}
            </SettingsBand>

            <SettingsBand
                className="flex min-h-0 flex-1 flex-col"
                last
                title="Fechamentos da clínica"
                description="Recesso, congresso, dedetização — o que fecha a agenda e não é feriado nacional."
            >
                {fechamentos.length === 0 ? (
                    /*
                     * Estado vazio com ação, como manda o DESIGN.md §5. Era um
                     * parágrafo pelado dizendo "Nenhum fechamento cadastrado",
                     * e o único botão de criar ficava no rodapé do cartão,
                     * **abaixo** da frase — o lugar onde se procura a ação não
                     * a oferecia, e a tela lia como se não houvesse como
                     * cadastrar.
                     */
                    /*
                     * Sem ação aqui: ela é do rodapé preso, visível o tempo
                     * todo 52px abaixo. Repeti-la seria a segunda ação primária
                     * do mesmo assunto, e a Tela 03 pede uma só por faixa.
                     */
                    <EmptyState
                        variant="inline"
                        icon={CalendarOff}
                        title="Nenhum fechamento cadastrado"
                        description="Recesso de fim de ano, congresso, dedetização — o que fecha a agenda e não é feriado nacional."
                    />
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                      <div className="flex flex-col divide-y divide-border">
                        {fechamentos.map((f) => (
                            <div key={f.id} className="py-2.5 first:pt-0 last:pb-0">
                                <SettingsRow
                                    title={f.name}
                                    description={
                                        <span>
                                            {porExtenso(f.startsOn)}
                                            {f.endsOn !== f.startsOn ? ` até ${porExtenso(f.endsOn)}` : ''}
                                            {f.allDay ? ' · dia todo' : ` · ${f.startTime}–${f.endTime}`}
                                            {!f.blocks ? ' · não bloqueia' : ''}
                                        </span>
                                    }
                                    action={
                                        canEdit ? (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label={`Remover ${f.name}`}
                                                onClick={() => setExcluindo(f)}
                                            >
                                                <Trash2 className="size-4 text-destructive-subtle-foreground" />
                                            </Button>
                                        ) : null
                                    }
                                />
                            </div>
                        ))}
                      </div>
                    </div>
                )}
            </SettingsBand>
          </div>

            <RecordDialog
                open={dialogo}
                onOpenChange={setDialogo}
                title="Novo fechamento"
                description="Vale para todos os especialistas e sobrepõe as janelas deles."
                submitLabel="Criar fechamento"
                hideAgain
                submitting={salvando}
                onSubmit={criar}
            >
                <div className="flex flex-col gap-4">
                    <FormField label="O que é" required error={erro ?? undefined}>
                        <Input
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="Recesso de fim de ano"
                            autoFocus
                        />
                    </FormField>

                    <div className="grid grid-cols-2 gap-3.5">
                        <FormField label="De" required>
                            <Input
                                type="date"
                                value={form.startsOn}
                                onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
                            />
                        </FormField>
                        <FormField label="Até" hint="Vazio = um dia só">
                            <Input
                                type="date"
                                value={form.endsOn}
                                onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
                            />
                        </FormField>
                    </div>

                    <FormField label="Dia todo">
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={form.allDay}
                                onCheckedChange={(v) => setForm({ ...form, allDay: v })}
                            />
                            <span className="text-xs text-muted-foreground">
                                Desligue para fechar só um pedaço do dia.
                            </span>
                        </div>
                    </FormField>

                    {!form.allDay ? (
                        <div className="grid grid-cols-2 gap-3.5">
                            <FormField label="Das">
                                <Input
                                    type="time"
                                    value={form.startTime}
                                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                                />
                            </FormField>
                            <FormField label="Às">
                                <Input
                                    type="time"
                                    value={form.endTime}
                                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                                />
                            </FormField>
                        </div>
                    ) : null}
                </div>
            </RecordDialog>

            <ConfirmDialog
                open={excluindo !== null}
                onOpenChange={(a) => !a && setExcluindo(null)}
                title="Remover fechamento"
                description={`"${excluindo?.name ?? ''}" sai do calendário e a agenda volta a aceitar marcações nessas datas.`}
                confirmLabel="Remover"
                destructive
                onConfirm={excluir}
            />
        </BandLayout>
    )
}
