'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, Info } from 'lucide-react'
import { toast } from 'sonner'
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
        // This was the only destructive action in the app that fired with no
        // confirmation at all — one stray click removed the response.
        if (!confirm('Tem certeza que deseja excluir esta resposta rápida?')) return

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

    return (
        <div className="p-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-h1">Respostas rápidas</h1>
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                        <Info className="h-4 w-4" />
                        Configurar mensagens rápidas para o chat
                    </p>
                </div>
                {canEdit && (
                    <Button onClick={() => setIsAdding(true)} className="bg-primary hover:bg-primary/90">
                        <Plus className="mr-2 h-4 w-4" />
                        Nova resposta
                    </Button>
                )}
            </div>

            {/* Table */}
            <div className="rounded-lg border bg-card overflow-hidden">
                {/* Table Header */}
                <div className="bg-muted/50 px-4 py-3 font-medium">
                    Mensagens pré-configuradas
                </div>
                <div className="grid grid-cols-[200px_1fr_100px] gap-4 bg-muted/30 px-4 py-2 text-sm font-medium border-t">
                    <div>Comando</div>
                    <div>Texto</div>
                    <div className="text-right">Ativo?</div>
                </div>

                {/* Table Body */}
                <div className="divide-y">
                    {loading ? (
                        <div className="p-8 text-center text-muted-foreground">Carregando...</div>
                    ) : responses.length === 0 && !isAdding ? (
                        <div className="p-8 text-center text-muted-foreground">
                            Nenhuma resposta rápida cadastrada
                        </div>
                    ) : (
                        <>
                            {responses.map((response) => (
                                <div key={response.id} className="grid grid-cols-[200px_1fr_100px] gap-4 p-4 items-center">
                                    <div className="font-mono text-sm text-primary">
                                        {response.command}
                                    </div>
                                    <div className="text-sm truncate">{response.text}</div>
                                    <div className="flex items-center justify-end gap-2">
                                        {canEdit ? (
                                            <>
                                                <button
                                                    onClick={() => toggleActive(response)}
                                                    className={`h-5 w-10 rounded-full transition-colors ${response.isActive ? 'bg-green-500' : 'bg-muted'
                                                        }`}
                                                >
                                                    <div className={`h-4 w-4 rounded-full bg-card transition-transform ${response.isActive ? 'translate-x-5' : 'translate-x-0.5'
                                                        }`} />
                                                </button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => deleteResponse(response.id!)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </>
                                        ) : (
                                            // Read-only: show the state without offering to change it.
                                            <span className="text-xs text-muted-foreground">
                                                {response.isActive ? 'Ativa' : 'Inativa'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </>
                    )}

                    {/* Add Row */}
                    {isAdding && (
                        <div className="grid grid-cols-[200px_1fr_100px] gap-4 p-4 items-center bg-muted/30">
                            <Input
                                placeholder="/comando"
                                value={newResponse.command}
                                onChange={(e) => setNewResponse({ ...newResponse, command: e.target.value })}
                                className="bg-background font-mono"
                            />
                            <Input
                                placeholder="Texto da resposta..."
                                value={newResponse.text}
                                onChange={(e) => setNewResponse({ ...newResponse, text: e.target.value })}
                                className="bg-background"
                            />
                            <div className="flex items-center gap-2">
                                <Button onClick={addResponse} size="sm">Salvar</Button>
                                <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
