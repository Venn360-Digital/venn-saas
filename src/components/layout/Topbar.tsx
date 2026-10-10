'use client'

import { activityType } from '@/lib/activity-types'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, LogOut, User, Settings, Volume2, VolumeX, Clock} from 'lucide-react'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { BreadcrumbTrail } from '@/components/layout/BreadcrumbTrail'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { useSoundEnabled } from '@/hooks/useSoundEnabled'

interface AppNotification {
    id: string
    kind: string
    title: string
    body: string | null
    link: string | null
    readAt: string | null
    createdAt: string
}

interface Reminder {
    id: string
    title: string
    type: string
    dueDate: string | null
    startTime: string | null
    reminderMinutes: number
    contact: { id: string; name: string | null } | null
    deal: { id: string; title: string } | null
}


function formatReminderTime(r: Reminder): string {
    if (!r.dueDate) return ''
    const d = new Date(r.dueDate)
    const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    return r.startTime ? `${dateStr} às ${r.startTime}` : dateStr
}

export function Topbar() {
    const [soundEnabled, setSoundEnabled] = useSoundEnabled()
    const [reminders, setReminders] = useState<Reminder[]>([])
    const [notifications, setNotifications] = useState<AppNotification[]>([])
    const [unread, setUnread] = useState(0)
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
    const router = useRouter()



    // Poll reminders every 60 seconds
    /**
     * Os avisos guardados, que sobrevivem ao navegador fechado.
     *
     * Vivem ao lado dos lembretes de atividade, que continuam sendo uma consulta
     * ao vivo: lembrete é "daqui a uma hora", aviso é "aconteceu e você precisa
     * saber". Juntá-los numa lista só seria misturar relógio com recado.
     */
    const loadNotifications = useCallback(async () => {
        try {
            const res = await fetch('/api/notifications')
            if (!res.ok) return
            const data = await res.json()
            setNotifications(data.items ?? [])
            setUnread(data.unread ?? 0)
        } catch { /* a campainha segue com o que tem */ }
    }, [])

    const markAllRead = async () => {
        setUnread(0)
        setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })))
        await fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        }).catch(() => { })
    }

    const loadReminders = useCallback(async () => {
        try {
            const res = await fetch('/api/activities/reminders')
            if (res.ok) {
                const data: Reminder[] = await res.json()
                setReminders(data)
                // Play sound for new reminders
                if (data.length > 0 && soundEnabled) {
                    const stored = localStorage.getItem('odontobox360-last-reminder-count')
                    const lastCount = stored ? parseInt(stored) : 0
                    if (data.length > lastCount) {
                        try { new Audio('/sounds/notification.mp3').play().catch(() => { }) } catch { }
                    }
                    localStorage.setItem('odontobox360-last-reminder-count', String(data.length))
                }
            }
        } catch { /* ignore */ }
    }, [soundEnabled])

    useEffect(() => {
        // `loadReminders` só chama setState depois do primeiro `await`; a regra
        // é baseada no compilador, não acompanha função assíncrona e acusa a
        // chamada em si. Buscar ao montar e repetir a cada 60 s é o que um
        // efeito existe para fazer. O caso real que a regra pegou neste arquivo
        // — ler `localStorage` e aplicar por setState — foi corrigido em
        // `useSoundEnabled`, não silenciado.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadReminders()
        void loadNotifications()
        const interval = setInterval(() => {
            loadReminders()
            void loadNotifications()
        }, 60000) // every 60s
        return () => clearInterval(interval)
    }, [loadReminders, loadNotifications])


    const handleDismissReminder = async (id: string) => {
        setDismissedIds(prev => new Set([...prev, id]))
        try {
            await fetch('/api/activities/reminders', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activityIds: [id] }),
            })
            setReminders(prev => prev.filter(r => r.id !== id))
        } catch { /* ignore */ }
    }

    const handleDismissAll = async () => {
        const ids = reminders.map(r => r.id)
        setDismissedIds(prev => new Set([...prev, ...ids]))
        try {
            await fetch('/api/activities/reminders', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activityIds: ids }),
            })
            setReminders([])
        } catch { /* ignore */ }
    }


    const activeReminders = reminders.filter(r => !dismissedIds.has(r.id))

    return (
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 md:px-6">

            {/* The trail is the one place that says where you are; the page's
                own h1 names the screen. Keeping them apart is what stops the name
                from appearing twice at the top of every page. */}
            <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger />
                <BreadcrumbTrail />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 sm:gap-3">
                {/* Sound Toggle */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    title={soundEnabled ? 'Desativar som de notificações' : 'Ativar som de notificações'}
                >
                    {soundEnabled ? (
                        <Volume2 className="h-5 w-5" />
                    ) : (
                        <VolumeX className="h-5 w-5 opacity-50" />
                    )}
                </Button>

                {/* Notifications Bell */}
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
                            <Bell className="h-5 w-5" />
                            {activeReminders.length + unread > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center num rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                                    {activeReminders.length + unread > 9 ? '9+' : activeReminders.length + unread}
                                </span>
                            )}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 p-0">
                        {/* Avisos guardados primeiro: eles já aconteceram, e o
                            lembrete ainda vai acontecer. */}
                        {notifications.length > 0 && (
                            <div className="border-b border-border">
                                <div className="flex items-center justify-between px-4 py-2.5">
                                    <h3 className="text-sm font-semibold">Avisos</h3>
                                    {unread > 0 && (
                                        <button
                                            onClick={() => void markAllRead()}
                                            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                                        >
                                            Marcar como lidos
                                        </button>
                                    )}
                                </div>
                                <div className="max-h-56 overflow-y-auto">
                                    {notifications.map((n) => (
                                        <Link
                                            key={n.id}
                                            href={n.link ?? '/dashboard'}
                                            className={cn(
                                                'flex items-start gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-0 hover:bg-accent/30',
                                                !n.readAt && 'bg-primary-subtle/40'
                                            )}
                                        >
                                            <div className={cn('mt-0.5 rounded-md bg-accent p-1.5', !n.readAt && 'text-primary-subtle-foreground')}>
                                                <Bell className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium">{n.title}</p>
                                                {n.body && (
                                                    <p className="whitespace-pre-line text-xs text-muted-foreground">{n.body}</p>
                                                )}
                                                <p className="num mt-0.5 text-[11px] text-muted-foreground/70">
                                                    {new Date(n.createdAt).toLocaleString('pt-BR', {
                                                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                                                    })}
                                                </p>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-between border-b border-border px-4 py-3">
                            <h3 className="text-sm font-semibold">Lembretes</h3>
                            {activeReminders.length > 0 && (
                                <button onClick={handleDismissAll}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                                    Limpar todos
                                </button>
                            )}
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                            {activeReminders.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                    <Bell className="h-8 w-8 mb-2 opacity-30" />
                                    <p className="text-sm">Nenhum lembrete pendente</p>
                                </div>
                            ) : (
                                activeReminders.map((r) => {
                                    const { icon: Icon, color } = activityType(r.type)
                                    return (
                                        <div key={r.id}
                                            className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
                                            <div className={cn("mt-0.5 p-1.5 rounded-md bg-accent", color)}>
                                                <Icon className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <Link href="/vendas/agenda"
                                                    className="text-sm font-medium hover:text-primary transition-colors block truncate">
                                                    {r.title}
                                                </Link>
                                                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {formatReminderTime(r)}
                                                    </span>
                                                </div>
                                                {(r.contact || r.deal) && (
                                                    <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                                                        {r.contact?.name}{r.contact && r.deal && ' • '}{r.deal?.title}
                                                    </div>
                                                )}
                                            </div>
                                            <button onClick={() => handleDismissReminder(r.id)}
                                                className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0 mt-1">
                                                ✕
                                            </button>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                        {activeReminders.length > 0 && (
                            <div className="border-t border-border px-4 py-2">
                                <Link href="/vendas/agenda"
                                    className="text-xs text-primary hover:underline">
                                    Ver todas as atividades →
                                </Link>
                            </div>
                        )}
                    </PopoverContent>
                </Popover>

                {/* Tema: três botões, ao lado do sino. É o lugar dos
                    interruptores desta natureza — som, notificações — e fica
                    visível em todo estado do shell, inclusive no rail
                    recolhido, onde no pé da sidebar ele desaparecia. */}
                <ThemeToggle />
            </div>
        </header>
    )
}
