'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { activityType } from '../../lib/activity-types'
import { cn } from '@venn/ui/utils'

interface ListedActivity {
    id: string
    title: string
    type: string
    dueDate: string | null
    startTime: string | null
    completedAt: string | null
    user?: { id: string; name: string | null } | null
}

/**
 * As atividades de um registro, e o clique que as conclui.
 *
 * Concluir era gesto exclusivo da Agenda: quem estava na conversa com o
 * paciente — ou na ficha do negócio, onde a lista já existia — via "pendente"
 * escrito e não tinha o que fazer a respeito sem trocar de tela. A lista vive
 * aqui, num componente só, porque as três telas pediam exatamente a mesma
 * coisa e já começavam a divergir: o painel do negócio desenhava a sua à mão e
 * não tinha o botão.
 *
 * O círculo é o mesmo da Agenda, e é `button` de verdade — concluir por engano
 * se desfaz clicando de novo, então não há confirmação no caminho.
 */
export function ActivityList({
    contactId,
    dealId,
    refreshToken,
    onChanged,
    className,
}: {
    contactId?: string | null
    dealId?: string | null
    /** Muda para reler a lista — depois de criar uma atividade, por exemplo. */
    refreshToken?: number
    onChanged?: () => void
    className?: string
}) {
    const [activities, setActivities] = useState<ListedActivity[] | null>(null)
    const [pending, setPending] = useState<string | null>(null)

    const load = useCallback(async () => {
        const params = new URLSearchParams()
        if (dealId) params.set('dealId', dealId)
        if (contactId) params.set('contactId', contactId)
        if (!params.toString()) {
            setActivities([])
            return
        }
        try {
            const res = await fetch(`/api/activities?${params}`)
            const data = res.ok ? await res.json() : []
            setActivities(Array.isArray(data) ? data : (data?.data ?? []))
        } catch {
            setActivities([])
        }
    }, [contactId, dealId])

    useEffect(() => { void load() }, [load, refreshToken])

    const toggle = async (activity: ListedActivity) => {
        setPending(activity.id)
        // Otimista: o círculo responde na hora, e a lista volta do servidor
        // depois. Sem isso o clique parecia não ter acontecido.
        const done = Boolean(activity.completedAt)
        setActivities((prev) =>
            prev?.map((a) =>
                a.id === activity.id
                    ? { ...a, completedAt: done ? null : new Date().toISOString() }
                    : a
            ) ?? prev
        )
        try {
            const res = await fetch(`/api/activities/${activity.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed: !done }),
            })
            if (!res.ok) throw new Error()
            onChanged?.()
        } catch {
            toast.error('Não foi possível atualizar a atividade')
        } finally {
            setPending(null)
            void load()
        }
    }

    if (activities === null) {
        return (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Carregando atividades…
            </p>
        )
    }

    if (activities.length === 0) {
        return (
            <div className={cn('rounded-md border border-dashed border-border px-3 py-5 text-center', className)}>
                <CalendarPlus className="mx-auto mb-2 size-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Nenhuma atividade por aqui.</p>
            </div>
        )
    }

    return (
        <ul className={cn('space-y-2', className)}>
            {activities.map((activity) => {
                const kind = activityType(activity.type)
                const done = Boolean(activity.completedAt)
                const overdue =
                    !done &&
                    activity.dueDate !== null &&
                    new Date(activity.dueDate) < new Date(new Date().toDateString())

                return (
                    <li
                        key={activity.id}
                        className={cn(
                            'flex items-start gap-2 rounded-md border border-border px-2.5 py-2',
                            done && 'opacity-60',
                            overdue && 'border-destructive/40 bg-destructive-subtle'
                        )}
                    >
                        <button
                            type="button"
                            onClick={() => void toggle(activity)}
                            disabled={pending === activity.id}
                            aria-pressed={done}
                            aria-label={done ? `Reabrir ${activity.title}` : `Concluir ${activity.title}`}
                            className="mt-0.5 shrink-0"
                        >
                            {done ? (
                                <CheckCircle2 className="size-4 text-success-subtle-foreground" />
                            ) : (
                                <Circle
                                    className={cn(
                                        'size-4',
                                        overdue
                                            ? 'text-destructive-subtle-foreground'
                                            : 'text-muted-foreground hover:text-primary'
                                    )}
                                />
                            )}
                        </button>

                        <div className="min-w-0 flex-1">
                            <p className={cn('flex items-center gap-1.5 text-[12px] font-semibold', done && 'line-through')}>
                                <kind.icon className={cn('size-3 shrink-0', kind.color)} />
                                <span className="truncate">{activity.title}</span>
                            </p>
                            <p className="num text-[11px] text-muted-foreground">
                                {activity.dueDate
                                    ? new Date(activity.dueDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                                    : 'sem data'}
                                {activity.startTime ? ` ${activity.startTime}` : ''}
                                {done ? ' · concluída' : overdue ? ' · atrasada' : ' · pendente'}
                            </p>
                        </div>
                    </li>
                )
            })}
        </ul>
    )
}
