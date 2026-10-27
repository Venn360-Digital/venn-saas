'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Megaphone, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { usePermissions } from '@/hooks/usePermissions'
import { useIndiceServidor } from '@/hooks/useIndiceServidor'

import { type CampanhaItem, type DadosIniciais, ORDEM_STATUS, STATUS_CAMPANHA } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'

interface ListaOpcao {
    id: string
    name: string
    memberCount: number
}
interface LinhaOpcao {
    integrationId: string
    label: string
}
interface TemplateOpcao {
    id: string
    metaName: string
    integrationId: string
    status: string
    variaveis: { body: number; header: number }
}

const EMPTY = {
    name: '',
    labels: '',
    integrationId: '',
    templateId: '',
    throttle: '30',
}

export function CampanhasClient({ inicial }: { inicial: DadosIniciais }) {
    const { canEdit } = usePermissions()
    const router = useRouter()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/marketing/campaigns')
        if (!res.ok) {
            toast.error('Não foi possível carregar as campanhas')
            return null
        }
        const itens = (await res.json()) as CampanhaItem[]
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    const { itens: campanhas, carregando: loading } = useIndiceServidor<CampanhaItem>({
        inicial,
        recorte: RECORTE_INTEIRO,
        buscar,
    })

    const [statusFiltro, setStatusFiltro] = useState<string>('all')

    const [open, setOpen] = useState(false)
    const [form, setForm] = useState(EMPTY)
    const [listIds, setListIds] = useState<string[]>([])
    const [bodyVars, setBodyVars] = useState<string[]>([])
    const [headerVars, setHeaderVars] = useState<string[]>([])
    const [submitting, setSubmitting] = useState(false)

    const [listas, setListas] = useState<ListaOpcao[]>([])
    const [linhas, setLinhas] = useState<LinhaOpcao[]>([])
    const [templates, setTemplates] = useState<TemplateOpcao[]>([])

    useEffect(() => {
        if (!open) return
        fetch('/api/marketing/lists')
            .then((r) => (r.ok ? r.json() : []))
            .then((d: ListaOpcao[]) => setListas(Array.isArray(d) ? d : []))
            .catch(() => {})
        fetch('/api/marketing/templates')
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { linhas?: LinhaOpcao[]; templates?: TemplateOpcao[] } | null) => {
                setLinhas(d?.linhas ?? [])
                setTemplates(d?.templates ?? [])
            })
            .catch(() => {})
    }, [open])

    function openNew() {
        setForm(EMPTY)
        setListIds([])
        setBodyVars([])
        setHeaderVars([])
        setOpen(true)
    }

    // Templates aprovados da linha escolhida.
    const templatesDaLinha = useMemo(
        () => templates.filter((t) => t.integrationId === form.integrationId && t.status === 'APPROVED'),
        [templates, form.integrationId],
    )
    const templateSel = templatesDaLinha.find((t) => t.id === form.templateId) ?? null

    // Os arrays de variáveis não são redimensionados ao trocar de template de
    // propósito: a tela lê por índice até o número de variáveis do template, e
    // `montarComponentes` corta o resto no envio — valor sobrando é ignorado nos
    // dois lados, então não há estado a sincronizar aqui.

    function toggleLista(id: string) {
        setListIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    }

    async function criar() {
        if (!form.name.trim()) { toast.error('Dê um nome à campanha'); return }
        if (listIds.length === 0) { toast.error('Escolha ao menos uma lista'); return }
        if (!form.integrationId) { toast.error('Escolha a linha oficial'); return }
        if (!form.templateId) { toast.error('Escolha um template aprovado'); return }

        setSubmitting(true)
        try {
            const res = await fetch('/api/marketing/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name.trim(),
                    labels: form.labels
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    integrationId: form.integrationId,
                    templateId: form.templateId,
                    listIds,
                    variables: { body: bodyVars, header: headerVars },
                    throttlePerMin: Number(form.throttle) || 30,
                }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => null)
                throw new Error(e?.error ?? 'Não foi possível criar a campanha')
            }
            const { id } = (await res.json()) as { id: string }
            toast.success('Campanha criada em rascunho')
            setOpen(false)
            router.push(`/marketing/campanhas/${id}`)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Não foi possível criar a campanha')
        } finally {
            setSubmitting(false)
        }
    }

    const visiveis =
        statusFiltro === 'all' ? campanhas : campanhas.filter((c) => c.status === statusFiltro)

    const columns: Column<CampanhaItem>[] = [
        {
            id: 'name',
            header: 'Campanha',
            sortable: true,
            sortValue: (c) => c.name,
            cell: (c) => (
                <div className="flex flex-col">
                    <span className="text-sm text-foreground">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.template}</span>
                </div>
            ),
        },
        {
            id: 'status',
            header: 'Situação',
            sortable: true,
            sortValue: (c) => c.status,
            width: '10rem',
            cell: (c) => <span className="text-sm">{STATUS_CAMPANHA[c.status] ?? c.status}</span>,
        },
        {
            id: 'line',
            header: 'Linha',
            width: '12rem',
            cell: (c) => <span className="text-sm text-muted-foreground">{c.line ?? '—'}</span>,
        },
        {
            id: 'progress',
            header: 'Enviados',
            width: '9rem',
            className: 'text-right',
            cell: (c) => (
                <span className="num text-sm">
                    {c.sentCount}
                    {c.totalCount > 0 ? ` / ${c.totalCount}` : ''}
                </span>
            ),
        },
    ]

    return (
        <>
            <IndexFrame
                title="Campanhas"
                primary={
                    <div className="flex items-center gap-2">
                        <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                            <SelectTrigger className="h-8 w-40" aria-label="Filtrar por situação">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                {ORDEM_STATUS.map((s) => (
                                    <SelectItem key={s} value={s}>
                                        {STATUS_CAMPANHA[s]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {canEdit ? (
                            <Button size="sm" className="h-8 gap-1.5" onClick={openNew}>
                                <Plus className="size-3.5" /> Nova campanha
                            </Button>
                        ) : null}
                    </div>
                }
            >
                <DataTable
                    frame
                    columns={columns}
                    rows={visiveis}
                    getRowId={(c) => c.id}
                    loading={loading}
                    onRowClick={(c) => router.push(`/marketing/campanhas/${c.id}`)}
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={Megaphone}
                            title="Nenhuma campanha ainda"
                            description="Dispare um template aprovado para uma lista de contatos pelo WhatsApp oficial."
                            action={
                                canEdit ? (
                                    <Button onClick={openNew}>
                                        <Plus /> Nova campanha
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={open}
                onOpenChange={setOpen}
                title="Nova campanha"
                description="Escolha a linha oficial, o template aprovado e as listas. Nasce em rascunho — você revisa e dispara na tela seguinte."
                submitLabel="Criar campanha"
                hideAgain
                onSubmit={criar}
                submitting={submitting}
            >
                <FormField label="Nome interno" htmlFor="c-name" required className="col-span-2">
                    <Input
                        id="c-name"
                        value={form.name}
                        onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Retorno semestral — outubro"
                        autoFocus
                    />
                </FormField>

                <FormField label="Rótulos" htmlFor="c-labels" hint="Opcional, separados por vírgula." className="col-span-2">
                    <Input
                        id="c-labels"
                        value={form.labels}
                        onChange={(e) => setForm((p) => ({ ...p, labels: e.target.value }))}
                        placeholder="retorno, ortodontia"
                    />
                </FormField>

                <FormField label="Linha oficial" htmlFor="c-line" required>
                    <Select
                        value={form.integrationId}
                        onValueChange={(v) => setForm((p) => ({ ...p, integrationId: v, templateId: '' }))}
                    >
                        <SelectTrigger id="c-line">
                            <SelectValue placeholder={linhas.length ? 'Escolha' : 'Nenhuma linha oficial'} />
                        </SelectTrigger>
                        <SelectContent>
                            {linhas.map((l) => (
                                <SelectItem key={l.integrationId} value={l.integrationId}>
                                    {l.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>

                <FormField label="Template" htmlFor="c-template" required>
                    <Select
                        value={form.templateId}
                        onValueChange={(v) => setForm((p) => ({ ...p, templateId: v }))}
                        disabled={!form.integrationId}
                    >
                        <SelectTrigger id="c-template">
                            <SelectValue
                                placeholder={
                                    !form.integrationId
                                        ? 'Escolha a linha primeiro'
                                        : templatesDaLinha.length
                                          ? 'Escolha'
                                          : 'Nenhum template aprovado'
                                }
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {templatesDaLinha.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                    {t.metaName}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>

                {templateSel && templateSel.variaveis.header > 0 && (
                    <div className="col-span-2 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Variáveis do cabeçalho</p>
                        {Array.from({ length: templateSel.variaveis.header }).map((_, i) => (
                            <Input
                                key={`h-${i}`}
                                value={headerVars[i] ?? ''}
                                onChange={(e) =>
                                    setHeaderVars((prev) => setAt(prev, i, e.target.value, templateSel.variaveis.header))
                                }
                                placeholder={`Cabeçalho {{${i + 1}}}`}
                            />
                        ))}
                    </div>
                )}

                {templateSel && templateSel.variaveis.body > 0 && (
                    <div className="col-span-2 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Variáveis do corpo</p>
                        {Array.from({ length: templateSel.variaveis.body }).map((_, i) => (
                            <Input
                                key={`b-${i}`}
                                value={bodyVars[i] ?? ''}
                                onChange={(e) =>
                                    setBodyVars((prev) => setAt(prev, i, e.target.value, templateSel.variaveis.body))
                                }
                                placeholder={`Corpo {{${i + 1}}}`}
                            />
                        ))}
                    </div>
                )}

                <FormField
                    label="Listas"
                    required
                    hint="Quem recebe. Só entra contato com telefone e sem opt-out."
                    className="col-span-2"
                >
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
                        {listas.length === 0 ? (
                            <p className="px-1 py-2 text-xs text-muted-foreground">
                                Nenhuma lista. Crie uma em Marketing → Listas.
                            </p>
                        ) : (
                            listas.map((l) => (
                                <label
                                    key={l.id}
                                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                                >
                                    <span className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={listIds.includes(l.id)}
                                            onChange={() => toggleLista(l.id)}
                                            className="size-4 accent-primary"
                                        />
                                        {l.name}
                                    </span>
                                    <span className="num text-xs text-muted-foreground">{l.memberCount}</span>
                                </label>
                            ))
                        )}
                    </div>
                </FormField>

                <FormField label="Ritmo (msgs/min)" htmlFor="c-throttle" hint="Quantas mensagens por minuto o disparo envia.">
                    <Input
                        id="c-throttle"
                        type="number"
                        min={1}
                        max={600}
                        value={form.throttle}
                        onChange={(e) => setForm((p) => ({ ...p, throttle: e.target.value }))}
                    />
                </FormField>
            </RecordDialog>
        </>
    )
}

/** Redimensiona um array de variáveis preservando o que já foi digitado. */
function ajustar(prev: string[], n: number): string[] {
    const out = prev.slice(0, n)
    while (out.length < n) out.push('')
    return out
}
function setAt(prev: string[], i: number, value: string, n: number): string[] {
    const out = ajustar(prev, n)
    out[i] = value
    return out
}
