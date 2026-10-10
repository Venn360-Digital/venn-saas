'use client'

import { forwardRef } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** DDD + 8 ou 9 dígitos. O país é do sistema, não do campo. */
const MAX_DIGITS = 11

/**
 * Só dígitos, e sem o código do país.
 *
 * Cada formulário tinha a sua ideia de telefone: um com `(00) 00000-0000`, um
 * com `31 99999 9999`, um sem placeholder, e todos aceitando o que fosse
 * digitado — inclusive o `55` na frente, que virava `5555319...` ao gravar,
 * porque a normalização acrescenta o país.
 *
 * Aqui o campo aceita dígito e nada mais. Máscara com parênteses e hífen saiu
 * de propósito: ela some no banco (que guarda dígitos), atrapalha colar de
 * outro sistema e dá a impressão de que a pontuação é parte do dado. O `55`
 * colado na frente é descartado, porque ninguém está digitando um número
 * internacional num formulário de clínica — e, se estiver, o campo de 11
 * dígitos não serviria mesmo.
 */
export const PhoneInput = forwardRef<HTMLInputElement, {
    value: string
    onChange: (digits: string) => void
    id?: string
    className?: string
    placeholder?: string
    autoFocus?: boolean
    'aria-label'?: string
}>(function PhoneInput({ value, onChange, id, className, placeholder, autoFocus, ...rest }, ref) {
    const clean = (raw: string) => {
        let digits = raw.replace(/\D/g, '')
        // Cola com país ("5531988501161" ou "+55 31 98850-1161"): o 55 sai, e só
        // quando sobra um número nacional plausível — senão "5531..." de um DDD
        // 55 inexistente seria mutilado à toa.
        if (digits.length > MAX_DIGITS && digits.startsWith('55')) digits = digits.slice(2)
        return digits.slice(0, MAX_DIGITS)
    }

    return (
        <Input
            ref={ref}
            id={id}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={value}
            onChange={(e) => {
                const next = clean(e.target.value)
                // O DOM precisa voltar ao valor limpo na mão.
                //
                // Num campo controlado, digitar "(" produz o mesmo valor de
                // estado de antes — e, como nada muda, o React não reconcilia o
                // nó e o caractere fica na tela. O dado salvo continuava certo;
                // o campo é que mentia, aceitando qualquer formato aos olhos de
                // quem digita.
                e.target.value = next
                onChange(next)
            }}
            onPaste={(e) => {
                // Interceptado para que o texto colado passe pela mesma limpeza
                // antes de aparecer no campo, em vez de piscar com pontuação. A
                // seleção é respeitada: colar sobre o número inteiro substitui,
                // em vez de concatenar.
                e.preventDefault()
                const input = e.currentTarget
                const start = input.selectionStart ?? value.length
                const end = input.selectionEnd ?? value.length
                onChange(clean(value.slice(0, start) + e.clipboardData.getData('text') + value.slice(end)))
            }}
            placeholder={placeholder ?? '31988501161'}
            maxLength={MAX_DIGITS}
            autoFocus={autoFocus}
            className={cn('num', className)}
            {...rest}
        />
    )
})
