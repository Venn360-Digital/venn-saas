import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'success' | 'warning' | 'destructive' | 'info' | 'primary'

export interface ToneEntry {
    label: string
    tone: Tone
}

interface StatusBadgeProps {
    /** The raw value from the API — a status, a role, an origin. */
    value: string | null | undefined
    /** Maps raw values to a label and a tone. Unmapped values render neutral. */
    map?: Record<string, ToneEntry>
    /** Use when the caller already knows the tone and just wants the chip. */
    tone?: Tone
    className?: string
}

const TONE_VARIANT = {
    neutral: 'neutral',
    success: 'success',
    warning: 'warning',
    destructive: 'destructive',
    info: 'info',
    primary: 'default',
} as const

/**
 * Status as one component instead of ~90 hand-tinted chips.
 *
 * The old ones paired a dark fill with a pale label from the raw Tailwind
 * scale, which only ever worked against a dark surface — on a white page they
 * were a dark block with barely-visible text. Routing every status through the semantic
 * tokens makes them legible in both modes and gives the tone one meaning across
 * screens, instead of green meaning "active" here and "paid" there.
 */
export function StatusBadge({ value, map, tone, className }: StatusBadgeProps) {
    if (!value) return <span className="text-muted-foreground">—</span>

    const entry = map?.[value]
    const resolved: Tone = entry?.tone ?? tone ?? 'neutral'

    return (
        <Badge variant={TONE_VARIANT[resolved]} className={cn(className)}>
            {entry?.label ?? value}
        </Badge>
    )
}

/* Shared vocabularies. A status that appears on more than one screen is defined
   once here so the two screens cannot disagree about its colour. */

export const DEAL_STATUS: Record<string, ToneEntry> = {
    OPEN: { label: 'Em aberto', tone: 'info' },
    WON: { label: 'Ganho', tone: 'success' },
    LOST: { label: 'Perdido', tone: 'destructive' },
}

export const ACTIVITY_STATUS: Record<string, ToneEntry> = {
    PENDING: { label: 'Pendente', tone: 'warning' },
    DONE: { label: 'Concluída', tone: 'success' },
    CANCELED: { label: 'Cancelada', tone: 'neutral' },
    LATE: { label: 'Atrasada', tone: 'destructive' },
}

export const WORKSPACE_ROLE: Record<string, ToneEntry> = {
    OWNER: { label: 'Proprietário', tone: 'primary' },
    ADMIN: { label: 'Administrador', tone: 'info' },
    GESTOR: { label: 'Gestor', tone: 'info' },
    ATENDENTE: { label: 'Atendente', tone: 'neutral' },
}

/**
 * Disponibilidade de quem atende — **não confundir com `ACTIVE_STATE`**, que é
 * se a pessoa tem acesso ao sistema.
 *
 * Verde recebe conversa; amarelo e cinza **não**, e são iguais para a
 * distribuição. A diferença entre os dois é para a equipe saber se vale chamar
 * no particular — por isso o rótulo é explícito, para ninguém supor que
 * "ocupado" recebe *menos* quando recebe *nada*.
 */
export const DISPONIBILIDADE: Record<string, ToneEntry> = {
    disponivel: { label: 'Disponível', tone: 'success' },
    ocupado: { label: 'Ocupado', tone: 'warning' },
    ausente: { label: 'Ausente', tone: 'neutral' },
}

export const ACTIVE_STATE: Record<string, ToneEntry> = {
    true: { label: 'Ativo', tone: 'success' },
    false: { label: 'Inativo', tone: 'neutral' },
}
