'use client'

import { useState, useEffect } from 'react'
import { MessageSquareText, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { usePermissions } from '@/hooks/usePermissions'

interface QuickResponse {
    id?: string
    command: string
    text: string
    isActive: boolean
}

export default function RespostasRapidasPage() {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Edit/Delete controls that answer 403.
    const { canEdit } = usePermissions()
    const [responses, setResponses] = useState<QuickResponse[]>([])
    const [loading, setLoading] = useState(true)
    const [isAdding, setIsAdding] = useState(false)
    const [deleting, setDeleting] = useState<QuickResponse | null>(null)
    const [newResponse, setNewResponse] = useState<QuickResponse>({
        command: '',
        text: '',
        isActive: true,
    })

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

    const addResponse = async () => {
        if (!newResponse.command.trim() || !newResponse.text.trim()) {
            toast.error('Preencha todos os campos')
            return
        }

        try {
            const res = await fetch('/api/quick-responses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newResponse),
            })

            if (res.ok) {
                const created = await res.json()
                setResponses([created, ...responses])
                setNewResponse({ command: '', text: '', isActive: true })
                setIsAdding(false)
                toast.success('Resposta criada com sucesso!')
            } else {
                toast.error('Erro ao criar resposta')
            }
        } catch (error) {
            console.error('Error creating response:', error)
            toast.error('Erro ao criar resposta')
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
                        <Button onClick={() => setIsAdding(true)} disabled={isAdding}>
                            <Plus />
                            Nova resposta
                        </Button>
                    ) : undefined
                }
            />
            <div className="space-y-3 px-4 pb-6 md:px-6">
                {isAdding ? (
                    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
                        <Input
                            placeholder="/comando"
                            value={newResponse.command}
                            onChange={e =>
                                setNewResponse({ ...newResponse, command: e.target.value })
                            }
                            aria-label="Comando da nova resposta"
                            className="font-mono sm:w-52"
                            autoFocus
                        />
                        <Input
                            placeholder="Texto da resposta…"
                            value={newResponse.text}
                            onChange={e =>
                                setNewResponse({ ...newResponse, text: e.target.value })
                            }
                            aria-label="Texto da nova resposta"
                            className="sm:flex-1"
                        />
                        <div className="flex items-center gap-2">
                            <Button onClick={addResponse}>Salvar</Button>
                            <Button variant="ghost" onClick={() => setIsAdding(false)}>
                                Cancelar
                            </Button>
                        </div>
                    </div>
                ) : null}

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
                                canEdit && !isAdding ? (
                                    <Button onClick={() => setIsAdding(true)}>
                                        <Plus />
                                        Nova resposta
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </div>

            {/* This was the only destructive action in the app that fired with no
                confirmation at all — one stray click removed the response. */}
            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={open => {
                    if (!open) setDeleting(null)
                }}
                title="Excluir resposta rápida?"
                description={`O atalho ${deleting?.command ?? ''} deixa de funcionar no chat e o texto é perdido.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={async () => {
                    if (deleting?.id) await deleteResponse(deleting.id)
                }}
            />
        </>
    )
}
