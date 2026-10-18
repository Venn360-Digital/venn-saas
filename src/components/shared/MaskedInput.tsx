'use client'

import { forwardRef } from 'react'

import { Input } from '@/components/ui/input'
import { applyMask, maskCapacity, maskRest, onlyDigits } from '@/lib/masks'
import { cn } from '@/lib/utils'

/**
 * Campo com molde que aparece ao digitar: o que já entrou em tinta normal, o
 * que falta em cinza por cima do campo ("12/05/19" + "00"). O estado guarda só
 * os dígitos; a pontuação é desenhada.
 *
 * O fantasma é um `span` sobreposto com a mesma fonte do campo, onde a parte
 * digitada fica invisível (só ocupa o espaço) e o resto do molde fica em cinza.
 * Backspace apaga o último dígito — a pontuação nunca é "digitada", então não
 * precisa ser apagada.
 */
export const MaskedInput = forwardRef<HTMLInputElement, {
    /** Só dígitos. */
    value: string
    onChange: (digits: string) => void
    mask: string
    /**
     * Teto de dígitos, quando ele **não** é o do molde.
     *
     * Existe para o campo que troca de molde conforme o tamanho: CPF ou CNPJ no
     * mesmo lugar. Com o molde de CPF ativo, o teto dele (11) comeria o décimo
     * segundo dígito e o campo ficaria preso em CPF para sempre.
     */
    capacity?: number
    id?: string
    className?: string
    disabled?: boolean
    autoFocus?: boolean
    'aria-label'?: string
    'aria-describedby'?: string
    'aria-invalid'?: boolean
    onBlur?: () => void
}>(function MaskedInput({ value, onChange, mask, capacity, id, className, disabled, autoFocus, onBlur, ...aria }, ref) {
    const teto = capacity ?? maskCapacity(mask)
    const digits = onlyDigits(value).slice(0, teto)
    const shown = applyMask(digits, mask)
    const rest = maskRest(digits, mask)

    return (
        <span className="relative block">
            <Input
                ref={ref}
                id={id}
                inputMode="numeric"
                autoComplete="off"
                value={shown}
                disabled={disabled}
                autoFocus={autoFocus}
                onBlur={onBlur}
                onChange={(e) => onChange(onlyDigits(e.target.value).slice(0, teto))}
                className={cn('num', className)}
                {...aria}
            />
            {rest ? (
                <span
                    aria-hidden="true"
                    className="num pointer-events-none absolute inset-y-0 left-0 flex items-center px-3 text-base md:text-sm"
                >
                    <span className="invisible whitespace-pre">{shown}</span>
                    <span className="whitespace-pre text-muted-foreground/60">{rest}</span>
                </span>
            ) : null}
        </span>
    )
})
