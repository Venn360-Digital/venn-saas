'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Pencil, Trash2, X, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A ficha lateral das telas de índice — o mesmo quadro da ficha do paciente,
 * para Etiquetas, Produtos, Departamentos, Respostas rápidas e Usuários.
 *
 * É a terceira coluna de 380px à direita da tabela (no celular toma a tela):
 * uma faixa de 40px com "Ficha", ‹ › para andar pela lista e × para fechar;
 * o corpo rola; o rodapé tem dois ícones com dica — o lápis abre o mesmo
 * diálogo do Novo em modo de edição, com todos os campos de uma vez, e a
 * lixeira exclui com confirmação. Os campos gravam ao sair, um a um — não há
 * botão Salvar, e o selo "salvo" ao lado do rótulo é o único aviso de que a
 * gravação aconteceu.
 */
export function RecordPanel({
    label,
    title,
    avatar,
    heading = 'Ficha',
    modes,
    mode,
    onModeChange,
    badge,
    onClose,
    onPrev,
    onNext,
    onEditFull,
    footerExtra,
    onDelete,
    editLabel,
    hint = '↑↓ navegam · Esc fecha',
    className,
    children,
}: {
    /** Para o leitor de tela: "Ficha da etiqueta Protocolo". */
    label: string
    /** O nome do registro, em negrito no topo. Vazio quando o corpo já traz o próprio cabeçalho. */
    title?: React.ReactNode
    avatar?: React.ReactNode
    /** A palavra da faixa de 40px. */
    heading?: string
    /** Os modos da ficha (resumo, arquivos, notas…), como ícones ao lado da palavra. */
    modes?: { id: string; label: string; icon: LucideIcon; disabled?: boolean }[]
    mode?: string
    onModeChange?: (id: string) => void
    /** Um selo na faixa — "salvo", "Ganho". */
    badge?: React.ReactNode
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onEditFull?: () => void
    /** Um gesto a mais entre o lápis e a lixeira — a bandeira do negócio. */
    footerExtra?: React.ReactNode
    onDelete?: () => void
    /** O que o lápis faz, quando não é "Editar no formulário". */
    editLabel?: string
    hint?: string
    /** Onde o painel vira coluna, quando não é em `lg`. */
    className?: string
    children: React.ReactNode
}) {
    return (
        <aside
            aria-label={label}
            className={cn(
                'absolute inset-0 z-20 flex flex-col bg-card',
                'lg:static lg:z-auto lg:w-[380px] lg:shrink-0 lg:border-l lg:border-border',
                className
            )}
        >
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border pl-4 pr-2">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{heading}</span>
                    {modes ? (
                        <span className="flex items-center gap-0.5">
                            {modes.map(({ id, label: l, icon: Icon, disabled }) => (
                                <Tooltip key={id}>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            disabled={disabled}
                                            aria-pressed={mode === id}
                                            aria-label={l}
                                            onClick={() => onModeChange?.(id)}
                                            className={cn('size-7', mode === id && 'bg-primary-subtle text-primary-subtle-foreground hover:bg-primary-subtle')}
                                        >
                                            <Icon className="size-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{l}</TooltipContent>
                                </Tooltip>
                            ))}
                        </span>
                    ) : null}
                    {badge}
                </span>
                <span className="flex items-center">
                    {/* O par só aparece onde há por onde andar: numa conversa a
                        ficha segue a conversa escolhida, e duas setas mortas no
                        topo diziam que havia uma lista aqui. */}
                    {onPrev || onNext ? (
                        <>
                            <Button variant="ghost" size="icon-sm" onClick={onPrev} disabled={!onPrev} aria-label="Registro anterior">
                                <ChevronLeft className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={onNext} disabled={!onNext} aria-label="Próximo registro">
                                <ChevronRight className="size-4" />
                            </Button>
                        </>
                    ) : null}
                    <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar ficha">
                        <X className="size-4" />
                    </Button>
                </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4">
                {title ? (
                    <div className="flex min-w-0 items-center gap-3">
                        {avatar}
                        <div className="min-w-0 truncate text-[15px] font-bold">{title}</div>
                    </div>
                ) : null}
                {children}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                <PanelActions onEditFull={onEditFull} editLabel={editLabel} extra={footerExtra} onDelete={onDelete} />
                <span className="num hidden lg:inline">{hint}</span>
            </div>
        </aside>
    )
}

/**
 * Os dois gestos do rodapé da ficha: editar no formulário (o diálogo do Novo,
 * com tudo de uma vez) e excluir. Ícones com dica, no mesmo lugar em toda ficha.
 */
export function PanelActions({ onEditFull, editLabel = 'Editar no formulário', extra, onDelete }: { onEditFull?: () => void; editLabel?: string; extra?: React.ReactNode; onDelete?: () => void }) {
    return (
        <div className="flex items-center gap-0.5">
            {onEditFull ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" onClick={onEditFull} aria-label={editLabel}>
                            <Pencil className="size-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{editLabel}</TooltipContent>
                </Tooltip>
            ) : null}
            {extra}
            {onDelete ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={onDelete}
                            aria-label="Excluir"
                            className="text-destructive-subtle-foreground hover:text-destructive-subtle-foreground"
                        >
                            <Trash2 className="size-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Excluir</TooltipContent>
                </Tooltip>
            ) : null}
        </div>
    )
}

export function PanelSection({
    title,
    aside,
    children,
}: {
    title: string
    aside?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <section className="border-t border-border pt-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
                {aside}
            </div>
            <div className="space-y-1.5">{children}</div>
        </section>
    )
}

/** Rótulo à esquerda, campo à direita, e o selo "salvo" por dois segundos. */
export function PanelField({
    label,
    htmlFor,
    saved = false,
    top = false,
    children,
}: {
    label: string
    htmlFor?: string
    saved?: boolean
    top?: boolean
    children: React.ReactNode
}) {
    return (
        <div className={cn('grid grid-cols-[88px_1fr] gap-2', top ? 'items-start' : 'items-center')}>
            <Label htmlFor={htmlFor} className={cn('flex items-center justify-between gap-1 text-xs text-muted-foreground', top && 'pt-2')}>
                <span className="truncate">{label}</span>
                {saved ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-success-subtle-foreground">
                        <Check className="size-3" /> salvo
                    </span>
                ) : null}
            </Label>
            <div className="min-w-0">{children}</div>
        </div>
    )
}

/**
 * Grava um campo por PATCH e acende o selo "salvo" dele por dois segundos.
 * Devolve também o que já foi gravado nesta ficha, para a tela mostrar o
 * valor novo antes de a lista recarregar.
 */
export function usePanelSave<T extends object>(url: string, onChanged: () => void, item?: T) {
    const [saved, setSaved] = useState<string | null>(null)
    // Os remendos valem só para o objeto que os recebeu: quando a lista
    // recarrega (e o diálogo de edição pode ter mudado tudo), o item novo
    // chega inteiro do servidor e o que foi gravado aqui já está nele.
    const [patched, setPatched] = useState<{ of: T | undefined; local: Partial<T> }>({ of: item, local: {} })
    const local: Partial<T> = patched.of === item ? patched.local : {}

    const save = useCallback(
        // `body` é o que vai para a API quando difere do que a tela guarda
        // (concluir manda `completed`, a ficha guarda `completedAt`).
        async (field: string, patch: Partial<T>, body: Record<string, unknown> = patch) => {
            try {
                const res = await fetch(url, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                })
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    toast.error(data.error || 'Não foi possível salvar')
                    return false
                }
                setPatched((prev) => ({ of: item, local: { ...(prev.of === item ? prev.local : {}), ...patch } }))
                setSaved(field)
                setTimeout(() => setSaved((s) => (s === field ? null : s)), 2000)
                onChanged()
                return true
            } catch {
                toast.error('Não foi possível salvar')
                return false
            }
        },
        [url, onChanged, item]
    )

    return { save, saved, local }
}

/**
 * ↑↓ passam de registro em registro sem fechar a ficha; Esc fecha. Dentro de
 * um campo as setas são do campo, e dentro de um diálogo nada disso vale.
 */
export function usePanelKeys(openId: string | null, ids: string[], setOpenId: (id: string | null) => void) {
    useEffect(() => {
        if (!openId) return
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null
            if (el && el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"], [role="menu"]')) return
            if (e.key === 'Escape') { setOpenId(null); return }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const i = ids.indexOf(openId)
                const next = e.key === 'ArrowDown' ? i + 1 : i - 1
                if (next >= 0 && next < ids.length) setOpenId(ids[next])
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [openId, ids, setOpenId])
}

/** Quem pode andar pela lista a partir de `openId`: ‹ e › para o pai ligar. */
export function panelNeighbours(openId: string | null, ids: string[], setOpenId: (id: string) => void) {
    const i = openId ? ids.indexOf(openId) : -1
    return {
        onPrev: i > 0 ? () => setOpenId(ids[i - 1]) : undefined,
        onNext: i >= 0 && i < ids.length - 1 ? () => setOpenId(ids[i + 1]) : undefined,
    }
}
