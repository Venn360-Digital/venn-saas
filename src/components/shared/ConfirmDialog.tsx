'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    /** Say what will be lost, concretely. "Isso não pode ser desfeito" alone is not enough. */
    description: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
    onConfirm: () => void | Promise<void>
}

/**
 * Replaces the native `confirm()`.
 *
 * Browser confirms cannot be styled or translated consistently, are suppressible
 * by the user without the app knowing, and in some embedded webviews never
 * appear at all — which silently turns "delete after confirmation" into "delete".
 */
export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    destructive = false,
    onConfirm,
}: ConfirmDialogProps) {
    const [pending, setPending] = useState(false)

    async function handleConfirm(event: React.MouseEvent) {
        // Keep the dialog open while the work runs, so a failure can surface
        // against the thing the user was looking at.
        event.preventDefault()
        setPending(true)
        try {
            await onConfirm()
            onOpenChange(false)
        } finally {
            setPending(false)
        }
    }

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleConfirm}
                        disabled={pending}
                        className={cn(
                            destructive &&
                                buttonVariants({ variant: 'destructive' })
                        )}
                    >
                        {pending ? <Loader2 className="animate-spin" /> : null}
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
