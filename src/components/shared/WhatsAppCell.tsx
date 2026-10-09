'use client'

import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { WhatsAppMark } from '@/components/shared/WhatsAppMark'
import { cn } from '@/lib/utils'

export interface WhatsAppTarget {
    id?: string
    name?: string | null
    phone?: string | null
}

/**
 * O atalho para a conversa, com o estado do número desenhado no ícone.
 *
 * Quatro estados, e nenhum deles mentindo: aceso e clicável quando o número tem
 * WhatsApp; apagado e inerte quando não tem; apagado enquanto a verificação não
 * voltou; e um traço quando não há telefone. O que não existe é um botão que
 * parece funcionar e levaria a uma conversa que nunca seria entregue.
 *
 * Os quatro ocupam a **mesma caixa** — um `Button` de ícone, ou um bloco do
 * mesmo tamanho — para que a coluna fique alinhada. A primeira versão desenhava
 * o estado apagado como um `span` solto, e ele caía à esquerda enquanto o aceso
 * ficava centrado no botão.
 */
export function WhatsAppCell({
    target,
    status,
    busy = false,
    onOpen,
    className,
}: {
    target: WhatsAppTarget
    /** `true` tem, `false` não tem, `null` não deu para verificar, ausente = verificando. */
    status: boolean | null | undefined
    busy?: boolean
    onOpen: (target: WhatsAppTarget) => void
    className?: string
}) {
    const box = cn('flex size-8 items-center justify-center', className)

    if (!target.phone) {
        return <span className={cn(box, 'text-xs text-muted-foreground')}>—</span>
    }

    if (status !== true) {
        const label =
            status === false
                ? 'Este número não tem WhatsApp'
                : status === null
                    ? 'Não foi possível verificar'
                    : 'Verificando no WhatsApp…'
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className={box}>
                        <WhatsAppMark className="size-4 text-muted-foreground/40" />
                        <span className="sr-only">{label}</span>
                    </span>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
        )
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={`Abrir conversa com ${target.name || target.phone}`}
                    className={className}
                    onClick={(e) => {
                        // A linha e o cartão têm o seu próprio clique; o ícone não
                        // pode disparar os dois.
                        e.stopPropagation()
                        onOpen(target)
                    }}
                >
                    {busy
                        ? <Loader2 className="size-4 animate-spin" />
                        : <WhatsAppMark className="size-4 text-success-subtle-foreground" />}
                </Button>
            </TooltipTrigger>
            <TooltipContent>Abrir conversa no WhatsApp</TooltipContent>
        </Tooltip>
    )
}
