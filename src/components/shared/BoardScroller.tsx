'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

    /**
     * Mede as bordas, e só escreve no estado quando elas mudam.
     *
     * A primeira versão media dentro de uma `ref` em linha: a função nascia de
     * novo a cada render, o React a chamava de novo, ela chamava `setState`, e o
     * render seguinte repetia tudo — laço infinito, que derrubava a tela do
     * quadro com "tente de novo". Comparar antes de escrever quebra o ciclo, e
     * medir num efeito tira a medição do caminho do render.
     */
    const measure = useCallback(() => {
        const el = ref.current
        if (!el) return
        const max = el.scrollWidth - el.clientWidth
        const next = { start: el.scrollLeft > 8, end: el.scrollLeft < max - 8 }
        setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
    }, [])

    useEffect(() => {
        measure()
        const el = ref.current
        if (!el || typeof ResizeObserver === 'undefined') return
        // Abrir o painel muda a largura sem rolar nada: sem observar o tamanho,
        // as setas só apareceriam no primeiro arrasto.
        const observer = new ResizeObserver(() => measure())
        observer.observe(el)
        return () => observer.disconnect()
    }, [measure, children])

    const slide = (direction: -1 | 1) => {
        const el = ref.current
        if (!el) return
        el.scrollBy({ left: direction * STEP, behavior: 'smooth' })
    }

    return (
        // `flex flex-col` para o quadro poder ocupar a altura que sobrar
        // quando a tela o pede (o kanban, que fixa a faixa de desfecho no
        // rodapé). Sem altura imposta de fora, nada muda: `flex-1` cai na
        // altura do conteúdo.
        <div className={cn('relative flex flex-col', className)}>
            <div
                ref={ref}
                onScroll={measure}
                // A rolagem vertical é deste elemento, não da região da página:
                // é assim que a faixa de Ganho e Perdido fica parada no rodapé
                // enquanto as colunas correm por baixo.
                className="flex min-h-0 flex-1 gap-4 overflow-x-auto overflow-y-auto pb-4"
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
