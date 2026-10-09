'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

interface SummaryState {
    summary: string | null
    generatedAt: string | null
    newMessages: number
}

/** As quatro seções que o prompt pede, na ordem em que o prompt as pede. */
const SECTIONS = ['Resumo', 'Pendências', 'Combinados', 'Tom'] as const

/**
 * Quebra o texto do modelo nas seções rotuladas.
 *
 * Um bloco de prosa de dez linhas não é lido por quem tem o paciente
 * esperando; "Pendências" com dois tópicos é. Se o modelo fugir do formato, o
 * texto inteiro cai em "Resumo" em vez de desaparecer.
 */
function parseSections(text: string): { label: string; body: string }[] {
    const found: { label: string; body: string }[] = []
    for (const label of SECTIONS) {
        const match = new RegExp(`^\\s*${label}\\s*:\\s*([\\s\\S]*?)(?=^\\s*(?:${SECTIONS.join('|')})\\s*:|$)`, 'im').exec(text)
        const body = match?.[1]?.trim()
        if (body) found.push({ label, body })
    }
    return found.length > 0 ? found : [{ label: 'Resumo', body: text.trim() }]
}

/**
 * O resumo da conversa, por IA.
 *
 * Gerar custa crédito do cliente, então abrir o painel só lê o que está
 * guardado — a geração é um botão, e o painel diz quantas mensagens chegaram
 * desde o último resumo para que apertá-lo seja uma decisão informada em vez
 * de um palpite.
 */
export function AiSummaryPanel({ conversationId }: { conversationId: string }) {
    const [state, setState] = useState<SummaryState | null>(null)
    const [generating, setGenerating] = useState(false)

    useEffect(() => {
        let cancelled = false
        fetch(`/api/conversations/${conversationId}/summary`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setState(data ?? { summary: null, generatedAt: null, newMessages: 0 })
            })
            .catch(() => {
                if (!cancelled) setState({ summary: null, generatedAt: null, newMessages: 0 })
            })
        return () => {
            cancelled = true
        }
    }, [conversationId])

    const generate = async () => {
        setGenerating(true)
        try {
            const res = await fetch(`/api/conversations/${conversationId}/summary`, { method: 'POST' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(data.error || 'Não foi possível gerar o resumo')
                return
            }
            setState({ summary: data.summary, generatedAt: data.generatedAt, newMessages: 0 })
        } catch {
            toast.error('Não foi possível gerar o resumo')
        } finally {
            setGenerating(false)
        }
    }

    if (state === null) {
        return (
            <p className="flex items-center gap-2 px-1 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Carregando…
            </p>
        )
    }

    if (!state.summary) {
        return (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
                <Sparkles className="mx-auto mb-2 size-5 text-muted-foreground" />
                <p className="mb-3 text-xs text-muted-foreground">
                    Ainda sem resumo. Gerar lê a conversa e consome créditos de IA.
                </p>
                <Button size="sm" onClick={() => void generate()} disabled={generating} className="gap-1.5">
                    {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    Gerar resumo
                </Button>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {parseSections(state.summary).map(({ label, body }) => (
                <div key={label}>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h4>
                    <div className="space-y-0.5 text-[13px] leading-relaxed">
                        {body.split('\n').map((line, i) => {
                            const bullet = line.trim().replace(/^[-•]\s*/, '')
                            if (!bullet) return null
                            return line.trim().startsWith('-') || line.trim().startsWith('•') ? (
                                <p key={i} className="flex gap-1.5">
                                    <span className="text-muted-foreground">•</span>
                                    <span>{bullet}</span>
                                </p>
                            ) : (
                                <p key={i}>{bullet}</p>
                            )
                        })}
                    </div>
                </div>
            ))}

            <div className="border-t border-border pt-2">
                <p className="num mb-2 text-[11px] text-muted-foreground">
                    Gerado em{' '}
                    {state.generatedAt
                        ? new Date(state.generatedAt).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                        })
                        : '—'}
                    {state.newMessages > 0
                        ? ` · ${state.newMessages} ${state.newMessages === 1 ? 'mensagem nova' : 'mensagens novas'} depois dele`
                        : ''}
                </p>
                <Button
                    size="sm"
                    variant={state.newMessages > 0 ? 'default' : 'outline'}
                    onClick={() => void generate()}
                    disabled={generating}
                    className="w-full gap-1.5"
                >
                    {generating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    Atualizar resumo
                </Button>
            </div>
        </div>
    )
}
