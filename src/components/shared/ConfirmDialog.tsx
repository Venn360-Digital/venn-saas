'use client'

import { useEffect, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    /**
     * Exige que a pessoa digite este texto antes de liberar a ação.
     *
     * Para o que não tem volta e leva dados junto. "Tem certeza?" é respondido
     * no reflexo; digitar o nome do que vai sumir obriga a ler o nome e a
     * conferir que é aquele mesmo — e é a diferença entre apagar o agente certo
     * e apagar o que estava ao lado na lista. Mesmo princípio do cancelamento
     * de assinatura, que pede o e-mail da conta (DESIGN.md §5).
     */
    confirmPhrase?: string
    /** O que dizer acima do campo. Ex.: "Digite o nome do agente para confirmar". */
    confirmPhraseLabel?: string
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
    confirmPhrase,
    confirmPhraseLabel,
    onConfirm,
}: ConfirmDialogProps) {
    const [pending, setPending] = useState(false)
    const [typed, setTyped] = useState('')

    // Reabrir o diálogo não pode herdar o que foi digitado antes: a trava só
    // vale se for vencida de novo, para o registro que está na tela agora.
    useEffect(() => {
        if (!open) setTyped('')
    }, [open])

    const locked = Boolean(confirmPhrase) && typed.trim() !== confirmPhrase?.trim()

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

                {confirmPhrase ? (
                    <div className="space-y-2">
                        <Label htmlFor="confirmacao">
                            {confirmPhraseLabel ?? `Digite "${confirmPhrase}" para confirmar`}
                        </Label>
                        <Input
                            id="confirmacao"
                            value={typed}
                            autoComplete="off"
                            disabled={pending}
                            placeholder={confirmPhrase}
                            onChange={(e) => setTyped(e.target.value)}
                        />
                    </div>
                ) : null}

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleConfirm}
                        disabled={pending || locked}
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
