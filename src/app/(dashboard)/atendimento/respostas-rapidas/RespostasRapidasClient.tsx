'use client'

import { useState, useCallback, useMemo } from 'react'
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
import { Pagination } from '@/components/shared/Pagination'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { usePermissions } from '@/hooks/usePermissions'

import { useIndiceServidor } from '@/hooks/useIndiceServidor'
import type { DadosIniciais, QuickResponseItem } from './dados'

const EMPTY_FORM = { command: '', text: '' }

/**
 * A chave de recorte desta tela — **constante**, e é o ponto todo.
 *
 * O hook só busca quando a chave muda, comparando-a com a que o servidor
 * serviu. Aqui o recorte do servidor nunca muda: `GET /api/quick-responses`
 * devolve o workspace inteiro, e busca e paginação são contas em memória sobre
 * essa lista — não saem daqui, não viram parâmetro de consulta. Então não existe
 * recorte a renegociar: a chave casa na montagem (nenhuma busca, nenhum
 * repinte) e segue casando para sempre. As releituras continuam existindo, só
 * são **explícitas**: `recarregar()` depois de gravar, excluir ou pausar.
 *
 * O dia que esta rota paginar, é esta chave que passa a descrever página,
 * limite e busca — como em Etiquetas.
 */
const RECORTE_INTEIRO = 'workspace-inteiro'

export function RespostasRapidasClient({ inicial }: { inicial: DadosIniciais }) {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Edit/Delete controls that answer 403.
    const { canEdit } = usePermissions()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/quick-responses')
        if (!res.ok) {
            toast.error('Não foi possível carregar as respostas rápidas')
            return null
        }
        // A rota devolve o array cru, sem envelope de paginação: o total e a
        // única página saem do próprio tamanho da lista, que é a verdade aqui.
        const itens = (await res.json()) as QuickResponseItem[]
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    /**
     * Semear, guardar a montagem e reler é disciplina igual em todo índice — e
     * por isso vem de `useIndiceServidor`, não copiada aqui. `total` e
     * `totalPages` do hook ficam de fora de propósito: os desta tela são
     * contados sobre o resultado da busca em memória, logo abaixo.
     */
    const {
        itens: responses,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<QuickResponseItem>({ inicial, recorte: RECORTE_INTEIRO, buscar })

    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(20)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [errors, setErrors] = useState<{ command?: string; text?: string }>({})
    const [submitting, setSubmitting] = useState(false)
    /** O diálogo do Novo em modo de edição: o id do registro aberto no formulário. */
    const [editingId, setEditingId] = useState<string | null>(null)
    const [deleting, setDeleting] = useState<QuickResponseItem | null>(null)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleting, setBulkDeleting] = useState(false)
    /** Qual ficha está aberta ao lado. ↑↓ andam pela lista; Esc fecha. */
    const [openId, setOpenId] = useState<string | null>(null)
    const rowIds = useMemo(() => responses.map((r) => r.id).filter((id): id is string => Boolean(id)), [responses])
    usePanelKeys(openId, rowIds, setOpenId)
    const openItem = openId ? responses.find((r) => r.id === openId) ?? null : null
    const [formData, setFormData] = useState(EMPTY_FORM)

    function openNew() {
        setEditingId(null)
        setFormData(EMPTY_FORM)
        setErrors({})
        setIsDialogOpen(true)
    }

    /** O lápis da ficha: o mesmo diálogo, com todos os campos do registro. */
    function openEdit(item: QuickResponseItem & { id: string }) {
        setEditingId(item.id)
        setFormData({ command: item.command, text: item.text })
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
            const res = await fetch(editingId ? `/api/quick-responses/${editingId}` : '/api/quick-responses', {
                method: editingId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command, text }),
            })
            if (!res.ok) {
                const error = await res.json().catch(() => null)
                setErrors({ command: error?.error ?? 'Não foi possível salvar a resposta' })
                return
            }
            toast.success(editingId ? 'Resposta atualizada' : 'Resposta criada')
            setErrors({})
            if (again && !editingId) setFormData(EMPTY_FORM)
            else setIsDialogOpen(false)
            void recarregar()
        } catch {
            toast.error('Não foi possível salvar a resposta')
        } finally {
            setSubmitting(false)
        }
    }

    const toggleActive = async (response: QuickResponseItem) => {
        if (!response.id) return

        try {
            const res = await fetch(`/api/quick-responses/${response.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !response.isActive }),
            })

            // Relê em vez de remendar a lista em mãos: o estado da lista é do
            // hook, e remendo local é como a tela passa a discordar do banco
            // (uma gravação concorrente da outra aba desaparecia aqui).
            if (res.ok) await recarregar()
            else toast.error('Não foi possível alterar a resposta')
        } catch (error) {
            console.error('Error updating response:', error)
            toast.error('Não foi possível alterar a resposta')
        }
    }

    const deleteResponse = async (id: string) => {
        try {
            const res = await fetch(`/api/quick-responses/${id}`, { method: 'DELETE' })

            if (!res.ok) {
                toast.error('Não foi possível remover a resposta')
                return
            }

            toast.success('Resposta removida')
            await recarregar()
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
        await recarregar()
    }

    // A API devolve a lista inteira; a busca e a paginação são daqui. A
    // página volta ao 1 quando a busca muda, senão a página 3 de um recorte
    // de 2 páginas fica vazia.
    const needle = search.trim().toLowerCase()
    const filtered = needle
        ? responses.filter((r) => r.command.toLowerCase().includes(needle) || r.text.toLowerCase().includes(needle))
        : responses
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const currentPage = Math.min(page, totalPages)
    const visibleResponses = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

    const columns: Column<QuickResponseItem>[] = [
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
                        onChanged={() => void recarregar()}
                        onEditFull={(id) => { const x = responses.find((i) => i.id === id); if (x?.id) openEdit({ ...x, id: x.id }) }}
                        onDelete={(id) => { const r = responses.find((x) => x.id === id); if (r) setDeleting(r) }}
                    />
                ) : null}
                title="Respostas rápidas"
                search={search}
                onSearchChange={(v) => { setSearch(v); setPage(1) }}
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
                    footer={
                        <Pagination
                            page={currentPage}
                            totalPages={totalPages}
                            total={filtered.length}
                            limit={pageSize}
                            onPageChange={setPage}
                            onLimitChange={(limit) => { setPageSize(limit); setPage(1) }}
                        />
                    }
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
                title={editingId ? 'Editar resposta rápida' : 'Nova resposta rápida'}
                description="Um atalho digitado no chat que vira o texto inteiro."
                submitLabel={editingId ? 'Salvar resposta' : 'Criar resposta'}
                hideAgain={editingId !== null}
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
