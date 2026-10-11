'use client'

import { UserRound } from 'lucide-react'

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface OwnerOption {
    userId: string
    name: string
}

/**
 * Por responsável — o mesmo seletor no Dashboard e na Agenda.
 *
 * Não aparece para quem não pode escolher. Atendente vê o próprio trabalho e
 * nada mais; um seletor travado em "você" seria um controle que não controla, e
 * a regra vive no servidor de qualquer forma (`resolveOwnerScope`) — esconder
 * aqui é conforto, não autorização.
 */
export function OwnerPicker({
    value,
    onChange,
    members,
    canChoose,
    className,
}: {
    /** `''` = todos. */
    value: string
    onChange: (userId: string) => void
    members: OwnerOption[]
    canChoose: boolean
    className?: string
}) {
    if (!canChoose) return null

    return (
        <Select value={value || 'all'} onValueChange={(v) => onChange(v === 'all' ? '' : v)}>
            <SelectTrigger
                size="sm"
                className={cn('w-[164px] shrink-0', className)}
                aria-label="Responsável"
            >
                <UserRound className="size-3.5 text-muted-foreground" />
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                        {member.name || 'Sem nome'}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
