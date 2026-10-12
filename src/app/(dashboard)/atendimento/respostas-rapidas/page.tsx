'use client'

import { useState, useEffect, useMemo } from 'react'
import { MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { BulkBar, deleteEach } from '@/components/shared/BulkBar'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { QuickResponsePanel } from '@/components/quick-responses/QuickResponsePanel'
import { panelNeighbours, usePanelKeys } from '@/components/shared/RecordPanel'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { usePermissions } from '@/hooks/usePermissions'

interface QuickResponse {
    id?: string
    command: string
    text: string
    isActive: boolean
}

const EMPTY_FORM = { command: '', text: '' }

export default function RespostasRapidasPage() {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Edit/Delete controls that answer 403.
    const { canEdit } = usePermissions()
    const [responses, setResponses] = useState<QuickResponse[]>([])
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [errors, setErrors] = useState<{ command?: string; text?: string }>({})
    const [submitting, setSubmitting] = useState(false)
    const [deleting, setDeleting] = useState<QuickResponse | null>(null)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleting, setBulkDeleting] = useState(false)
    /** Qual ficha está aberta ao lado. ↑↓ andam pela lista; Esc fecha. */
    const [openId, setOpenId] = useState<string | null>(null)
    const rowIds = useMemo(() => responses.map((r) => r.id).filter((id): id is string => Boolean(id)), [responses])
    usePanelKeys(openId, rowIds, setOpenId)
    const openItem = openId ? responses.find((r) => r.id === openId) ?? null : null
    const [formData, setFormData] = useState(EMPTY_FORM)

    useEffect(() => {
        loadResponses()
    }, [])

    const loadResponses = async () => {
        try {
            const res = await fetch('/api/quick-responses')
            if (res.ok) {
                setResponses(await res.json())
            }
        } catch (error) {
            console.error('Error loading responses:', error)
        } finally {
            setLoading(false)
        }
    }

    function openNew() {
        setFormData(EMPTY_FORM)
        setErrors({})
        setIsDialogOpen(true)
    }

    /** `again` = Criar e novo: grava, limpa e fica aberto. */
    async function handleSave(again: boolean) {
        const command = formData.command.trim()
        const text = formData.text.trim()
        const next: { command?: string; text?: string } = {}
        if (!command) next.command = 'Informe o atalho que será digitado no chat.'
        if (!text) next.text = 'Informe o texto que será enviado.'
        if (next.command || next.text) {
            setErrors(next)
            return
        }
        setSubmitting(true)
        try {
            const res = await fetch('/api/quick-responses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command, text }),
            })
            if (!res.ok) {
                const error = await res.json().catch(() => null)
                setErrors({ command: error?.error ?? 'Não foi possível salvar a resposta' })
                return
            }
            toast.success('Resposta criada')
            setErrors({})
            if (again) setFormData(EMPTY_FORM)
            else setIsDialogOpen(false)
            loadResponses()
        } catch {
            toast.error('Não foi possível salvar a resposta')
        } finally {
            setSubmitting(false)
        }
    }

    const toggleActive = async (response: QuickResponse) => {
        if (!response.id) return

        try {
            const res = await fetch(`/api/quick-responses/${response.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !response.isActive }),
            })

            if (res.ok) {
                setResponses(responses.map(r =>
                    r.id === response.id ? { ...r, isActive: !r.isActive } : r
                ))
            }
        } catch (error) {
            console.error('Error updating response:', error)
        }
    }

    const deleteResponse = async (id: string) => {
        try {
            const res = await fetch(`/api/quick-responses/${id}`, { method: 'DELETE' })

            if (!res.ok) {
                toast.error('Não foi possível remover a resposta')
                return
            }

            setResponses(responses.filter(r => r.id !== id))
            toast.success('Resposta removida')
        } catch (error) {
            console.error('Error deleting response:', error)
            toast.error('Erro ao remover resposta')
        }
    }

    const deleteSelected = async () => {
        const ok = await deleteEach(selectedIds, (id) => `/api/quick-responses/${id}`)
        if (ok > 0) toast.success(`${ok} ${ok === 1 ? 'resposta' : 'respostas'} excluída${ok === 1 ? '' : 's'}`)
        if (ok < selectedIds.length) toast.error(`${selectedIds.length - ok} não puderam ser excluídas`)
        setSelectedIds([])
        await loadResponses()
    }

    const needle = search.trim().toLowerCase()
    const visibleResponses = needle
        ? responses.filter((r) => r.command.toLowerCase().includes(needle) || r.text.toLowerCase().includes(needle))
        : responses

    const columns: Column<QuickResponse>[] = [
        {
            id: 'command',
            header: 'Comando',
            sortable: true,
            sortValue: (q) => q.command ?? '',
            width: '13rem',
            cell: response => (
                <span className="font-mono text-sm text-primary">{response.command}</span>
            ),
        },
        {
            id: 'text',
            header: 'Texto',
            sortable: true,
            sortValue: (q) => q.text,
            // The one column that may wrap: a canned message is a sentence, and
            // truncating it hides the only thing that tells two apart.
            className: 'max-w-xl whitespace-normal',
            cell: response => <span className="text-sm">{response.text}</span>,
        },
        {
            id: 'isActive',
            header: 'Ativa',
            sortable: true,
            sortValue: (q) => (q.isActive ? 1 : 0),
            width: '6rem',
            cell: response =>
                canEdit ? (
                    <Switch
                        checked={response.isActive}
                        onCheckedChange={() => toggleActive(response)}
                        aria-label={`Ativar resposta ${response.command}`}
                    />
                ) : (
                    // Read-only: show the state without offering to change it.
                    <span className="text-xs text-muted-foreground">
                        {response.isActive ? 'Ativa' : 'Inativa'}
                    </span>
                ),
        },
    ]

    return (
        <>
            <IndexFrame
                aside={openItem ? (
                    <QuickResponsePanel
                        key={openItem.id}
                        item={{ ...openItem, id: openItem.id! }}
                        canEdit={canEdit}
                        onClose={() => setOpenId(null)}
                        {...panelNeighbours(openId, rowIds, setOpenId)}
                        onChanged={() => void loadResponses()}
                        onDelete={(id) => { const r = responses.find((x) => x.id === id); if (r) setDeleting(r) }}
                    />
                ) : null}
                title="Respostas rápidas"
                search={search}
                onSearchChange={setSearch}
                searchLabel="Buscar por atalho ou texto"
                primary={
                    canEdit ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={openNew}>
                            <Plus className="size-3.5" /> Nova resposta
                        </Button>
                    ) : null
                }
            >
                <DataTable
                    frame
                    selectable={canEdit}
                    selected={selectedIds}
                    onSelectedChange={setSelectedIds}
                    bulkActions={(ids) => (
                        <BulkBar count={ids.length} noun={['resposta', 'respostas']} feminine onDelete={() => setBulkDeleting(true)} onClear={() => setSelectedIds([])} />
                    )}
                    columns={columns}
                    rows={visibleResponses}
                    getRowId={response => response.id ?? response.command}
                    loading={loading}
                    onRowClick={(r) => { if (r.id) setOpenId(r.id) }}
                    rowActions={
                        canEdit
                            ? response => (
                                  <RowActions label={`Ações da resposta ${response.command}`}>
                                      <RowActionItem
                                          icon={Pencil}
                                          onClick={() => setOpenId(response.id!)}
                                      >
                                          Abrir ficha
                                      </RowActionItem>
                                      <RowActionItem
                                          icon={Trash2}
                                          destructive
                                          onClick={() => setDeleting(response)}
                                      >
                                          Excluir
                                      </RowActionItem>
                                  </RowActions>
                              )
                            : undefined
                    }
                    mobile={response => (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-sm text-primary">
                                    {response.command}
                                </span>
                                {canEdit ? (
                                    <Switch
                                        checked={response.isActive}
                                        onCheckedChange={() => toggleActive(response)}
                                        aria-label={`Ativar resposta ${response.command}`}
                                    />
                                ) : (
                                    <span className="text-xs text-muted-foreground">
                                        {response.isActive ? 'Ativa' : 'Inativa'}
                                    </span>
                                )}
                            </div>
                            <p className="text-sm text-muted-foreground">{response.text}</p>
                        </div>
                    )}
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={MessageSquareText}
                            title="Nenhuma resposta rápida ainda"
                            description="Crie um atalho como /orcamento para enviar a mensagem pronta no chat."
                            action={
                                canEdit ? (
                                    <Button onClick={openNew}>
                                        <Plus />
                                        Nova resposta
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                title="Nova resposta rápida"
                description="Um atalho digitado no chat que vira o texto inteiro."
                submitLabel="Criar resposta"
                onSubmit={handleSave}
                submitting={submitting}
                summary={
                    <>
                        <span className="font-mono text-xs text-primary-subtle-foreground">{formData.command.trim() || '/atalho'}</span>
                        <div className="max-w-full self-start rounded-2xl rounded-tl-sm bg-card px-3 py-2 text-xs leading-relaxed shadow-xs">
                            {formData.text.trim() || <span className="text-muted-foreground">O texto que será enviado, como o paciente vai ler.</span>}
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">Nasce ativa. Dá para pausar na lista sem apagar.</p>
                    </>
                }
            >
                <FormField label="Comando" htmlFor="qr-command" required error={errors.command} hint="O atalho digitado no chat para inserir o texto." className="col-span-2">
                    <Input
                        id="qr-command"
                        value={formData.command}
                        onChange={e => { setFormData(prev => ({ ...prev, command: e.target.value })); if (errors.command) setErrors(p => ({ ...p, command: undefined })) }}
                        placeholder="/orcamento"
                        className="font-mono"
                        aria-invalid={errors.command ? true : undefined}
                        autoFocus
                    />
                </FormField>

                <FormField label="Texto" htmlFor="qr-text" required error={errors.text} className="col-span-2">
                    <Textarea
                        id="qr-text"
                        value={formData.text}
                        onChange={e => { setFormData(prev => ({ ...prev, text: e.target.value })); if (errors.text) setErrors(p => ({ ...p, text: undefined })) }}
                        placeholder="Olá! Segue o orçamento solicitado…"
                        rows={6}
                        aria-invalid={errors.text ? true : undefined}
                    />
                </FormField>
            </RecordDialog>

            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={open => {
                    if (!open) setDeleting(null)
                }}
                title="Excluir resposta rápida"
                description={`O atalho "${deleting?.command ?? ''}" deixa de funcionar no chat e o texto é perdido.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={async () => {
                    if (deleting?.id) await deleteResponse(deleting.id)
                }}
            />
            <ConfirmDialog
                open={bulkDeleting}
                onOpenChange={(open) => !open && setBulkDeleting(false)}
                title={`Excluir ${selectedIds.length} ${selectedIds.length === 1 ? 'resposta' : 'respostas'}`}
                description="Os atalhos marcados deixam de funcionar no chat e os textos são perdidos."
                confirmLabel="Excluir"
                destructive
                onConfirm={deleteSelected}
            />
        </>
    )
}
