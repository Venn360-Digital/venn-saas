'use client'

import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

/**
 * Uma seção no canvas, arrastável pela alça.
 *
 * Só a **alça** recebe os `listeners` do dnd-kit: o editor dentro da seção é
 * `contentEditable`, e um arrasto que começasse no texto roubaria a seleção.
 * As setas ↑↓ continuam ao lado, para teclado e para quem não arrasta — o
 * `KeyboardSensor` também move pela alça (Espaço, setas, Espaço).
 *
 * Compartilhada entre o editor do documento e o de modelos: é o mesmo canvas.
 */
export function SecaoArrastavel({
    id,
    idDoElemento,
    rotulo,
    className,
    desabilitado = false,
    onFocusCapture,
    children,
}: {
    id: string
    /** O `id` do `<li>`, para o sumário rolar até ele. */
    idDoElemento: string
    /** Para o leitor de tela: "Arrastar Carta". */
    rotulo: string
    className?: string
    /** Documento enviado não se reordena. */
    desabilitado?: boolean
    onFocusCapture?: () => void
    children: ReactNode
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: desabilitado })
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }
    return (
        <li ref={setNodeRef} style={style} id={idDoElemento} onFocusCapture={onFocusCapture} className={className}>
            {!desabilitado && (
                <button
                    type="button"
                    {...attributes}
                    {...listeners}
                    className="float-left mr-2 mt-0.5 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-accent active:cursor-grabbing"
                    aria-label={`Arrastar ${rotulo}`}
                >
                    <GripVertical className="size-4" aria-hidden />
                </button>
            )}
            {children}
        </li>
    )
}
