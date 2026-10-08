'use client'

import { MoreVertical, type LucideIcon } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface RowActionsProps {
    /**
     * Names *this* row's menu. Without it a screen reader hears fourteen
     * identical "Ações" buttons and cannot tell which row it is on.
     */
    label: string
    children: React.ReactNode
}

/**
 * The "Ações" cell, once.
 *
 * Five screens each repeated the same trigger — and drifted: two used
 * `MoreHorizontal` where three used `MoreVertical`, one sized it `icon`
 * (36px) where the rest used `icon-sm` (32px), and one shipped no
 * `aria-label` at all. The pattern belongs in one file.
 */
export function RowActions({ label, children }: RowActionsProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={label}>
                    <MoreVertical />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                {children}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

interface RowActionItemProps extends React.ComponentProps<typeof DropdownMenuItem> {
    icon?: LucideIcon
    /** Red label for anything that destroys data. */
    destructive?: boolean
}

export function RowActionItem({
    icon: Icon,
    destructive = false,
    className,
    children,
    ...props
}: RowActionItemProps) {
    return (
        <DropdownMenuItem
            className={cn(
                // Not `variant="destructive"`: that paints raw `--destructive`,
                // which reads 5.62:1 on light and 4.66:1 on dark. The subtle
                // foreground reads 8.18:1 and 6.56:1 on the same surfaces.
                destructive &&
                    'text-destructive-subtle-foreground focus:text-destructive-subtle-foreground [&_svg]:text-destructive-subtle-foreground',
                className
            )}
            {...props}
        >
            {Icon ? <Icon className="size-4" /> : null}
            {children}
        </DropdownMenuItem>
    )
}

export { DropdownMenuSeparator as RowActionsSeparator }
