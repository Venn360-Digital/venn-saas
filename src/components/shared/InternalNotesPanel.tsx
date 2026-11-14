'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, StickyNote } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { CampoDeNota } from '@/components/conversas/CampoDeNota'

interface InternalNote {
    id: string
    content: string
    createdAt: string
    author: string | null
}

/**
 * As notas internas desta conversa, separadas do fio.
 *
 * A nota continua aparecendo entre as mensagens, que é onde ela faz sentido
 * quando é recente. Este painel resolve o outro caso: a nota que importa foi
 * escrita há semanas, e procurá-la no fio é rolar cento e cinquenta
 * mensagens. Criar aqui usa o mesmo caminho do ícone de nota no compositor —
 * uma mensagem `isInternal`, não um segundo tipo de registro —, então a nota
 * criada no painel aparece no fio e vice-versa.
 */
export function InternalNotesPanel({
    conversationId,
    /** Avisa a tela para reler o fio: a nota nova também é uma mensagem. */
    onCreated,
    /**
     * Quantas notas o fio já mostra.
     *
     * Serve de gatilho: uma nota escrita pelo ícone do compositor, com o painel
     * aberto, muda este número e a lista relê. Sem isso a lista ficaria
     * desatualizada justamente para quem usa os dois caminhos.
     */
    refreshToken = 0,
}: {
    conversationId: string
    onCreated?: () => void
    refreshToken?: number
}) {
    const [notes, setNotes] = useState<InternalNote[] | null>(null)
    const [draft, setDraft] = useState('')
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/conversations/${conversationId}/notes`)
            const data = res.ok ? await res.json() : null
            setNotes(data?.notes ?? [])
        } catch {
            setNotes([])
        }
    }, [conversationId])

    useEffect(() => {
        let cancelled = false
        fetch(`/api/conversations/${conversationId}/notes`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setNotes(data?.notes ?? [])
            })
            .catch(() => {
                if (!cancelled) setNotes([])
            })
        return () => {
            cancelled = true
        }
    }, [conversationId, refreshToken])

    const save = async () => {
        const content = draft.trim()
        if (!content) return
        setSaving(true)
        try {
            const res = await fetch(`/api/conversations/${conversationId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, isInternal: true }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || 'Não foi possível salvar a nota')
                return
            }
            setDraft('')
            await load()
            onCreated?.()
        } catch {
            toast.error('Não foi possível salvar a nota')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-3">
            <div className="space-y-1.5">
                {/* `CampoDeNota` e não `Textarea`: marcar `@colega` aqui é o
                    único gesto que põe alguém a colaborar na conversa — não há
                    botão de assinar —, e sem o seletor a pessoa teria de
                    digitar `@[Nome](cku123…)` com o id do colega. */}
                <CampoDeNota value={draft} onChange={setDraft} onSubmit={() => void save()} />
                <Button
                    size="sm"
                    onClick={() => void save()}
                    disabled={saving || !draft.trim()}
                    className="w-full gap-1.5"
                >
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    Salvar nota
                </Button>
            </div>

            {notes === null ? (
                <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Carregando notas…
                </p>
            ) : notes.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-5 text-center">
                    <StickyNote className="mx-auto mb-2 size-5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                        Nenhuma nota interna nesta conversa.
                    </p>
                </div>
            ) : (
                <div className="space-y-2 border-t border-border pt-2">
                    {notes.map((note) => (
                        <div
                            key={note.id}
                            className="rounded-md border border-warning-subtle bg-warning-subtle/40 px-2.5 py-2"
                        >
                            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{note.content}</p>
                            <p className="num mt-1 text-[11px] text-muted-foreground">
                                {note.author ? `${note.author} · ` : ''}
                                {new Date(note.createdAt).toLocaleString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
