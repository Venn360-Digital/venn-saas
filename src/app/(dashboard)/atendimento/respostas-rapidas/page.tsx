'use client'

import { useState, useEffect } from 'react'
import { MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { FormField } from '@/components/shared/FormField'
import { PageHeader } from '@/components/shared/PageHeader'
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
    const [loading, setLoading] = useState(true)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editing, setEditing] = useState<QuickResponse | null>(null)
    const [deleting, setDeleting] = useState<QuickResponse | null>(null)
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

    function handleOpenDialog(response?: QuickResponse) {
        if (response) {
            setEditing(response)
            setFormData({ command: response.command, text: response.text })
        } else {
            setEditing(null)
            setFormData(EMPTY_FORM)
        }
        setIsDialogOpen(true)
    }

    async function handleSave() {
        const command = formData.command.trim()
        const text = formData.text.trim()

        if (!command) {
            toast.error('Informe o comando da resposta')
            return
        }
        if (!text) {
            toast.error('Informe o texto que será enviado')
            return
        }

        try {
            const res = await fetch(
                editing?.id ? `/api/quick-responses/${editing.id}` : '/api/quick-responses',
                {
                    method: editing?.id ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command, text }),
                }
            )

            if (!res.ok) {
                const error = await res.json().catch(() => null)
                toast.error(error?.error ?? 'Não foi possível salvar a resposta')
                return
            }

            toast.success(editing ? 'Resposta atualizada' : 'Resposta criada')
            setIsDialogOpen(false)
            loadResponses()
        } catch {
            toast.error('Não foi possível salvar a resposta')
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

    const columns: Column<QuickResponse>[] = [
        {
            id: 'command',
            header: 'Comando',
            width: '13rem',
            cell: response => (
                <span className="font-mono text-sm text-primary">{response.command}</span>
            ),
        },
        {
            id: 'text',
            header: 'Texto',
            // The one column that may wrap: a canned message is a sentence, and
            // truncating it hides the only thing that tells two apart.
            className: 'max-w-xl whitespace-normal',
            cell: response => <span className="text-sm">{response.text}</span>,
        },
        {
            id: 'isActive',
            header: 'Ativa',
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
            <PageHeader
                title="Respostas rápidas"
                description="Mensagens prontas para usar no chat."
                actions={
                    canEdit ? (
                        <Button onClick={() => handleOpenDialog()}>
                            <Plus />
                            Nova resposta
                        </Button>
                    ) : undefined
                }
            />
            <div className="space-y-3 px-4 pb-6 md:px-6">
                <DataTable
                    columns={columns}
                    rows={responses}
                    getRowId={response => response.id ?? response.command}
                    loading={loading}
                    rowActions={
                        canEdit
                            ? response => (
                                  <RowActions label={`Ações da resposta ${response.command}`}>
                                      <RowActionItem
                                          icon={Pencil}
                                          onClick={() => handleOpenDialog(response)}
                                      >
                                          Editar
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
                                    <Button onClick={() => handleOpenDialog()}>
                                        <Plus />
                                        Nova resposta
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? 'Editar resposta rápida' : 'Nova resposta rápida'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        <FormField
                            label="Comando"
                            htmlFor="qr-command"
                            required
                            hint="O atalho digitado no chat para inserir o texto."
                        >
                            <Input
                                id="qr-command"
                                value={formData.command}
                                onChange={e =>
                                    setFormData(prev => ({ ...prev, command: e.target.value }))
                                }
                                placeholder="/orcamento"
                                className="font-mono"
                                autoFocus
                            />
                        </FormField>

                        <FormField label="Texto" htmlFor="qr-text" required>
                            <Textarea
                                id="qr-text"
                                value={formData.text}
                                onChange={e =>
                                    setFormData(prev => ({ ...prev, text: e.target.value }))
                                }
                                placeholder="Olá! Segue o orçamento solicitado…"
                                rows={4}
                            />
                        </FormField>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave}>
                            {editing ? 'Salvar' : 'Criar resposta'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
        </>
    )
}
