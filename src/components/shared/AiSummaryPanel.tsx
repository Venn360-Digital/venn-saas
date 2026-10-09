'use client'

import { useEffect, useState } from 'react'
import { CalendarCheck, CalendarOff, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { activityType } from '@/lib/activity-types'

interface Appointment {
    id: string
    title: string
    type: string
    dueDate: string
    startTime: string | null
}

interface SummaryState {
    summary: string | null
    generatedAt: string | null
    newMessages: number
    appointments: Appointment[]
}

/**
 * O agendamento, antes do resumo.
 *
 * É a pergunta que se faz primeiro ao abrir uma conversa — "esse paciente tem
 * consulta marcada?" — e a resposta não vem do texto gerado: vem da Agenda, a
 * cada abertura do painel. Texto de IA envelhece; uma data lida do banco não.
 */
function Appointments({ appointments }: { appointments: Appointment[] }) {
    if (appointments.length === 0) {
        return (
            <div className="flex items-start gap-2 rounded-md border border-dashed border-border px-2.5 py-2">
                <CalendarOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                    Sem agendamento futuro. Use <span className="font-medium text-foreground">Agendar atividade</span> na faixa acima.
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-1.5">
            {appointments.map((appointment) => {
                const kind = activityType(appointment.type)
                const when = new Date(appointment.dueDate)
                return (
                    <div
                        key={appointment.id}
                        className="flex items-start gap-2 rounded-md border border-success-subtle bg-success-subtle/40 px-2.5 py-2"
                    >
                        <CalendarCheck className="mt-0.5 size-3.5 shrink-0 text-success-subtle-foreground" />
                        <div className="min-w-0">
                            <p className="num text-xs font-semibold">
                                {when.toLocaleDateString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: '2-digit',
                                })}
                                {appointment.startTime ? ` às ${appointment.startTime}` : ''}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                                {kind.label} · {appointment.title}
                            </p>
                        </div>
                    </div>
                )
            })}
        </div>
    )
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
                if (!cancelled) {
                    setState(data ?? { summary: null, generatedAt: null, newMessages: 0, appointments: [] })
                }
            })
            .catch(() => {
                if (!cancelled) setState({ summary: null, generatedAt: null, newMessages: 0, appointments: [] })
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
            setState({
                summary: data.summary,
                generatedAt: data.generatedAt,
                newMessages: 0,
                appointments: data.appointments ?? [],
            })
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
            <div className="space-y-3">
                <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agendamento</h4>
                    <Appointments appointments={state.appointments} />
                </div>
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
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agendamento</h4>
                <Appointments appointments={state.appointments} />
            </div>

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
