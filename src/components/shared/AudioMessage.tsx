'use client'

import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'

import { cn } from '@/lib/utils'
import { TextoDeWhatsApp } from '@/components/shared/TextoDeWhatsApp'

/**
 * A voice note, with its transcription treated as content.
 *
 * The bubble used to carry a bare `<audio controls>`: a browser surface that
 * belongs to no design system, looks different in every browser, ignores the
 * theme, and is tall enough to crowd out the transcription we pay OpenAI to
 * produce — which sat under it as faint italics and read as a caption nobody
 * needed. Here the control is ours and small, and the transcription is the part
 * you can actually read.
 */
export function AudioMessage({
    src,
    transcript,
    className,
}: {
    /**
     * O arquivo tocável — **opcional de propósito**.
     *
     * A nota de voz chega, é transcrita e só depois é arquivada, e o
     * arquivamento pode falhar sozinho (provedor fora, credencial trocada).
     * Quando falha, `mediaUrl` fica nulo — e até 29/10 a tela simplesmente não
     * desenhava nada disto, porque a condição era `contentType === 'audio' &&
     * mediaUrl`. O efeito: a transcrição existia no banco e a atendente lia
     * "🎵 Áudio" na tela.
     *
     * **Poder ouvir e poder ler são coisas diferentes, e aqui deixaram de estar
     * amarradas.** Sem arquivo, o player some e a transcrição fica.
     */
    src?: string | null
    transcript?: string | null
    className?: string
}) {
    const ref = useRef<HTMLAudioElement>(null)
    const [playing, setPlaying] = useState(false)
    const [elapsed, setElapsed] = useState(0)
    const [total, setTotal] = useState(0)

    useEffect(() => {
        const el = ref.current
        if (!el) return
        const onTime = () => setElapsed(el.currentTime)
        const onMeta = () => setTotal(Number.isFinite(el.duration) ? el.duration : 0)
        const onEnd = () => {
            setPlaying(false)
            setElapsed(0)
        }
        el.addEventListener('timeupdate', onTime)
        el.addEventListener('loadedmetadata', onMeta)
        el.addEventListener('ended', onEnd)
        return () => {
            el.removeEventListener('timeupdate', onTime)
            el.removeEventListener('loadedmetadata', onMeta)
            el.removeEventListener('ended', onEnd)
        }
    }, [src])

    const toggle = () => {
        const el = ref.current
        if (!el) return
        if (el.paused) {
            void el.play()
            setPlaying(true)
        } else {
            el.pause()
            setPlaying(false)
        }
    }

    const seek = (event: React.MouseEvent<HTMLDivElement>) => {
        const el = ref.current
        if (!el || !total) return
        const box = event.currentTarget.getBoundingClientRect()
        const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
        el.currentTime = ratio * total
        setElapsed(el.currentTime)
    }

    const progress = total ? (elapsed / total) * 100 : 0
    const shown = playing || elapsed > 0 ? elapsed : total

    return (
        <div className={cn('min-w-[200px] max-w-[260px]', className)}>
            {src ? (
                <>
                <audio ref={ref} src={src} preload="metadata" className="hidden" />
                <div className="flex items-center gap-2.5">
                    <button
                        type="button"
                        onClick={toggle}
                        aria-label={playing ? 'Pausar nota de voz' : 'Ouvir nota de voz'}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-current/15 transition-colors hover:bg-current/25"
                    >
                        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    {/* A click target, not a decorative waveform: the bar is the
                        position in the recording and seeking works on it. */}
                    <div
                        onClick={seek}
                        role="presentation"
                        className="h-1 flex-1 cursor-pointer overflow-hidden rounded-full bg-current/20"
                    >
                        <div className="h-full rounded-full bg-current/70" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="num shrink-0 text-[11px] opacity-70">{formatClock(shown)}</span>
                </div>
                </>
            ) : (
                // Sem arquivo, dizer que ele não está disponível é melhor do que
                // um player que não toca — e a transcrição abaixo segue valendo.
                <p className="text-[11px] italic opacity-60">Nota de voz (áudio indisponível)</p>
            )}
            {transcript ? (
                <div className={cn('mt-2 pt-2', src && 'border-t border-current/15')}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide opacity-55">Transcrição</p>
                    <TextoDeWhatsApp
                        texto={transcript}
                        className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-snug"
                    />
                </div>
            ) : null}
        </div>
    )
}

function formatClock(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
}
