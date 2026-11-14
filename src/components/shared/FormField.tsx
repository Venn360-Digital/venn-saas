import { useId } from 'react'

import { Label } from '@venn/ui/label'
import { cn } from '@venn/ui/utils'

interface FormFieldProps {
    label: string
    /** Omit to let the field generate one and wire it to the control itself. */
    htmlFor?: string
    hint?: string
    error?: string
    required?: boolean
    className?: string
    children: React.ReactNode | ((ids: FieldIds) => React.ReactNode)
}

export interface FieldIds {
    id: string
    'aria-describedby'?: string
    'aria-invalid'?: boolean
}

/**
 * Label, hint and error as one unit.
 *
 * The modals hand-rolled this roughly sixty times, each with its own label
 * styling — and the hint, where there was one, was usually plain text with no
 * `aria-describedby`, so a screen reader announced the field without the rule it
 * had to satisfy. The login's eight-character minimum was enforced but never
 * shown at all, which reads to the user as the form silently refusing.
 *
 * Pass children as a function to receive the wired ids:
 *   <FormField label="E-mail">{(ids) => <Input {...ids} />}</FormField>
 */
export function FormField({
    label,
    htmlFor,
    hint,
    error,
    required = false,
    className,
    children,
}: FormFieldProps) {
    const generated = useId()
    const id = htmlFor ?? generated
    const hintId = hint ? `${id}-hint` : undefined
    const errorId = error ? `${id}-error` : undefined
    const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

    return (
        <div className={cn('space-y-2', className)}>
            <Label htmlFor={id}>
                {label}
                {required ? (
                    <span className="text-destructive-subtle-foreground" aria-hidden="true">
                        *
                    </span>
                ) : null}
            </Label>

            {typeof children === 'function'
                ? children({
                      id,
                      'aria-describedby': describedBy,
                      'aria-invalid': error ? true : undefined,
                  })
                : children}

            {error ? (
                <p id={errorId} className="text-xs text-destructive-subtle-foreground">
                    {error}
                </p>
            ) : hint ? (
                <p id={hintId} className="text-xs text-muted-foreground">
                    {hint}
                </p>
            ) : null}
        </div>
    )
}
