'use client'

import { useCallback, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Quanto uma seta anda. Pouco mais que uma coluna, para o olho acompanhar. */
const STEP = 280

/**
 * O quadro com setas quando não cabe.
 *
 * Com o painel aberto, o quadro perde largura e as últimas fases saem de vista.
 * Rolagem horizontal existe, mas num trackpad de notebook ela é um gesto que
 * metade das pessoas não descobre — e com o mouse comum não existe. As setas
 * aparecem só quando há para onde ir, e somem quando não há.
 *
 * O estado é lido do próprio elemento no evento de rolagem, não guardado em
 * duplicata: `scrollLeft` já é a verdade, e copiá-la para o React criaria duas
 * versões da mesma coisa para divergirem.
 */
export function BoardScroller({ children, className }: { children: React.ReactNode; className?: string }) {
    const ref = useRef<HTMLDivElement>(null)
    const [edges, setEdges] = useState({ start: false, end: false })

    const measure = useCallback((el: HTMLDivElement | null) => {
        if (!el) return
        const max = el.scrollWidth - el.clientWidth
        setEdges({ start: el.scrollLeft > 8, end: el.scrollLeft < max - 8 })
    }, [])

    const slide = (direction: -1 | 1) => {
        const el = ref.current
        if (!el) return
        el.scrollBy({ left: direction * STEP, behavior: 'smooth' })
    }

    return (
        <div className={cn('relative', className)}>
            <div
                ref={(el) => { ref.current = el; measure(el) }}
                onScroll={(e) => measure(e.currentTarget)}
                className="flex gap-4 overflow-x-auto pb-4"
            >
                {children}
            </div>

            {edges.start ? (
                <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Fases anteriores"
                    onClick={() => slide(-1)}
                    className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md"
                >
                    <ChevronLeft className="size-4" />
                </Button>
            ) : null}

            {edges.end ? (
                <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Próximas fases"
                    onClick={() => slide(1)}
                    className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md"
                >
                    <ChevronRight className="size-4" />
                </Button>
            ) : null}
        </div>
    )
}
