'use client'

import { forwardRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { MASKS, applyMask, maskRest } from '@/lib/masks'
import { nationalDigits, phoneIssue } from '@/lib/phone'
import { cn } from '@/lib/utils'

/** DDD + 8 ou 9 dígitos. O país é do sistema, não do campo. */
const MAX_DIGITS = 11

/**
 * Só dígitos, sem o código do país, e o erro aparece ao sair do campo.
 *
 * Cada formulário tinha a sua ideia de telefone: um com `(00) 00000-0000`, um
 * com `31 99999 9999`, um sem placeholder, e todos aceitando o que fosse
 * digitado — inclusive o `55` na frente, que virava `5555319...` ao gravar,
 * porque a normalização acrescenta o país.
 *
 * Aqui o campo aceita dígito e nada mais — o estado é só dígitos. A pontuação
 * `(31) 99612-4480` é desenhada por cima enquanto se digita (o molde que
 * falta aparece em cinza), e nunca chega ao banco nem ao que se cola.
 *
 * Duas coisas que faltavam e faziam a máscara parecer quebrada **na edição**:
 *
 * 1. O valor vinha do banco com o país. Abrir um paciente para editar mostrava
 *    `5531988501161` — 13 dígitos e um `55` que este mesmo campo recusa ao ser
 *    digitado. Agora o que entra passa por `nationalDigits` antes de aparecer,
 *    então o campo exibe o que ele aceita.
 * 2. Nada avisava que o número estava errado. Um telefone incompleto é um
 *    cadastro que nunca será reencontrado — nem pela busca, nem pela mensagem
 *    que chega depois. O campo fica vermelho ao sair (não enquanto se digita,
 *    senão ele passa a vida inteira em erro), e quem grava chama `phoneIssue`
 *    para barrar com o motivo.
 */
export const PhoneInput = forwardRef<HTMLInputElement, {
    value: string
    onChange: (digits: string) => void
    id?: string
    className?: string
    placeholder?: string
    autoFocus?: boolean
    /** Campo de leitura — quem não administra a conta vê e não muda. */
    disabled?: boolean
    'aria-label'?: string
}>(function PhoneInput({ value, onChange, id, className, placeholder, autoFocus, disabled, ...rest }, ref) {
    // Erro só depois de sair do campo: 3 dígitos digitados ainda não são um
    // telefone errado, são um telefone pela metade.
    const [touched, setTouched] = useState(false)

    const clean = (raw: string) => {
        let digits = raw.replace(/\D/g, '')
        // Cola com país ("5531988501161" ou "+55 31 98850-1161"): o 55 sai, e só
        // quando sobra um número nacional plausível — senão "5531..." de um DDD
        // 55 inexistente seria mutilado à toa.
        if (digits.length > MAX_DIGITS && digits.startsWith('55')) digits = digits.slice(2)
        return digits.slice(0, MAX_DIGITS)
    }

    // O que se vê é sempre a forma nacional, mesmo que o estado de fora ainda
    // guarde o número com o país (é o caso ao abrir um cadastro para editar).
    const shown = nationalDigits(value)
    const invalid = touched && phoneIssue(shown) !== null
    // 10 dígitos é fixo: o molde de 8 vale quando o número está completo.
    const mask = shown.length === 10 ? MASKS.phone8 : MASKS.phone
    const pretty = applyMask(shown, mask)
    const ghost = maskRest(shown, MASKS.phone)

    return (
        <span className="relative block">
        <Input
            ref={ref}
            id={id}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={pretty}
            aria-invalid={invalid || undefined}
            onFocus={() => setTouched(false)}
            onBlur={() => setTouched(true)}
            onChange={(e) => {
                const next = clean(e.target.value)
                // O DOM precisa voltar ao valor limpo na mão.
                //
                // Num campo controlado, digitar "(" produz o mesmo valor de
                // estado de antes — e, como nada muda, o React não reconcilia o
                // nó e o caractere fica na tela. O dado salvo continuava certo;
                // o campo é que mentia, aceitando qualquer formato aos olhos de
                // quem digita.
                e.target.value = applyMask(next, next.length === 10 ? MASKS.phone8 : MASKS.phone)
                onChange(next)
            }}
            onPaste={(e) => {
                // Interceptado para que o texto colado passe pela mesma limpeza
                // antes de aparecer no campo, em vez de piscar com pontuação. A
                // seleção é respeitada: colar sobre o número inteiro substitui,
                // em vez de concatenar.
                e.preventDefault()
                const input = e.currentTarget
                const start = input.selectionStart ?? shown.length
                const end = input.selectionEnd ?? shown.length
                onChange(clean(shown.slice(0, start) + e.clipboardData.getData('text') + shown.slice(end)))
            }}
            placeholder={placeholder}
            maxLength={MASKS.phone.length}
            autoFocus={autoFocus}
            disabled={disabled}
            className={cn('num', className)}
            {...rest}
        />
        {shown.length < MAX_DIGITS && shown.length !== 10 ? (
            <span aria-hidden="true" className="num pointer-events-none absolute inset-y-0 left-0 flex items-center px-3 text-base md:text-sm">
                <span className="invisible whitespace-pre">{pretty}</span>
                <span className="whitespace-pre text-muted-foreground/60">{ghost}</span>
            </span>
        ) : null}
        </span>
    )
})
