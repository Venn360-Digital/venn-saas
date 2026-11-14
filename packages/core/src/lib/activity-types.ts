import {
    Calendar,
    CheckCircle2,
    ClipboardList,
    FileText,
    Mail,
    Phone,
    RotateCcw,
    Video,
    type LucideIcon,
} from 'lucide-react'

/**
 * The seven activity types, defined once.
 *
 * They were defined three times — in the deals screen, the agenda and the topbar
 * — with three different colour schemes, so "Ligação" was blue in one place and
 * green in another and the colour told the user nothing. Every copy also used
 * the -400 step, which is a dark-mode value: on the white surfaces those read as
 * pale on pale.
 *
 * Colours come from the chart ramp, which is defined for both modes and already
 * keeps adjacent entries in different hue families.
 */
export interface ActivityType {
    id: string
    label: string
    icon: LucideIcon
    /** Icon and label colour. */
    color: string
    /** Tinted background for a chip or a calendar cell. */
    bg: string
    /** Solid dot for a legend or a timeline marker. */
    dot: string
}

export const ACTIVITY_TYPES: ActivityType[] = [
    {
        id: 'meeting',
        label: 'Reunião',
        icon: Calendar,
        color: 'text-chart-1',
        bg: 'bg-chart-1/10',
        dot: 'bg-chart-1',
    },
    {
        id: 'call',
        label: 'Ligação',
        icon: Phone,
        color: 'text-chart-2',
        bg: 'bg-chart-2/10',
        dot: 'bg-chart-2',
    },
    {
        id: 'videocall',
        label: 'Videochamada',
        icon: Video,
        color: 'text-chart-4',
        bg: 'bg-chart-4/10',
        dot: 'bg-chart-4',
    },
    {
        id: 'email',
        label: 'E-mail',
        icon: Mail,
        color: 'text-chart-3',
        bg: 'bg-chart-3/10',
        dot: 'bg-chart-3',
    },
    {
        id: 'followup',
        label: 'Follow-up',
        icon: RotateCcw,
        color: 'text-chart-5',
        bg: 'bg-chart-5/10',
        dot: 'bg-chart-5',
    },
    {
        id: 'task',
        label: 'Tarefa',
        icon: ClipboardList,
        color: 'text-warning-subtle-foreground',
        bg: 'bg-warning-subtle',
        dot: 'bg-warning',
    },
    {
        id: 'note',
        label: 'Nota',
        icon: FileText,
        color: 'text-muted-foreground',
        bg: 'bg-muted',
        dot: 'bg-muted-foreground',
    },
]

export const ACTIVITY_TYPE_BY_ID: Record<string, ActivityType> = Object.fromEntries(
    ACTIVITY_TYPES.map((t) => [t.id, t])
)

const FALLBACK: ActivityType = {
    id: 'task',
    label: 'Atividade',
    icon: CheckCircle2,
    color: 'text-muted-foreground',
    bg: 'bg-muted',
    dot: 'bg-muted-foreground',
}

/** Never returns undefined — an unknown type from the API still renders. */
export function activityType(id: string | null | undefined): ActivityType {
    return (id && ACTIVITY_TYPE_BY_ID[id]) || FALLBACK
}
