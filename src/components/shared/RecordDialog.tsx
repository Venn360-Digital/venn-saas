'use client'

import { useId, useState } from 'react'
import { Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * O diálogo de cadastro — o quadro padrão de todo "Novo".
 *
 * **840 × 700, sempre** — a altura em que o Novo paciente cabe sem rolar.
 * Formulário curto deixa espaço vazio embaixo; é o preço de o Criar estar
 * sempre no mesmo ponto da tela, em qualquer cadastro.
 * Cabeçalho e rodapé presos; só a coluna do formulário rola. À direita, o
 * resumo vivo — como o registro vai aparecer na lista — fica parado.
 *
 * Três botões, três destinos: Cancelar fecha sem gravar; **Criar e novo**
 * grava, limpa e deixa o foco no primeiro campo; **Criar X** grava e fecha
 * (quem chama decide se abre a ficha). ⌘↵ cria, ⌘⇧↵ cria e novo, Esc fecha.
 *
 * Obrigatório é o asterisco vermelho no rótulo (`FormField required`), e a
 * legenda vive no rodapé ao lado dos atalhos. Erro aparece abaixo do campo,
 * em vermelho — nunca um toast, nunca um resumo no topo.
 *
 * Abaixo de `md` o quadro toma a tela e o resumo desce para baixo do
 * formulário.
 */
export function RecordDialog({
    open,
    onOpenChange,
    title,
    description,
    submitLabel,
    onSubmit,
    submitting = false,
    summary,
    hideAgain = false,
    size = 'default',
    submitDisabled = false,
    destructive = false,
    children,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: string
    /** "Criar paciente" — verbo e objeto, nunca "Salvar". Sem ele o quadro é
        de leitura e o rodapé traz só Fechar. */
    submitLabel?: string
    /** `again` = Criar e novo: quem chama grava, limpa o formulário e não fecha. */
    onSubmit?: (again: boolean) => void | Promise<void>
    submitting?: boolean
    /** O resumo vivo da coluna direita. */
    summary?: React.ReactNode
    /** Edição: sem "Criar e novo". */
    hideAgain?: boolean
    /**
     * `wide` para o que é de ler e comparar, não de preencher: três planos lado
     * a lado ou nove parágrafos de contrato. Em 840px as colunas do plano
     * cortavam o texto e o quadro rolava; o formulário continua em 840, que é
     * a largura de duas colunas de campo.
     */
    size?: 'default' | 'wide'
    /** Trava a ação primária enquanto a condição de segurança não é cumprida. */
    submitDisabled?: boolean
    /** A ação primária destrói algo: botão vermelho, como no alerta. */
    destructive?: boolean
    children: React.ReactNode
}) {
    const formId = useId()
    const [again, setAgain] = useState(false)

    const submit = (isAgain: boolean) => {
        if (!onSubmit || submitDisabled) return
        setAgain(isAgain)
        void onSubmit(isAgain)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className={cn(
                    // `bg-card` e não `bg-background`: no claro o fundo da página é
                    // azulado; o quadro de cadastro é branco, como a ficha.
                    'flex h-svh w-svw max-w-none flex-col gap-0 overflow-hidden rounded-none bg-card p-0',
                    'md:max-h-[calc(100svh-2rem)] md:max-w-[calc(100vw-2rem)] md:rounded-xl',
                    // O largo cresce com o conteúdo: três planos ocupam meia
                    // tela, e esticá-los até o rodapé deixava um vão morto.
                    size === 'wide'
                        ? 'md:h-auto md:w-[1120px]'
                        : 'md:h-[700px] md:w-[840px]'
                )}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        submit(e.shiftKey && !hideAgain)
                    }
                }}
            >
                {/* Cabeçalho preso */}
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 pb-3.5 pt-[18px]">
                    <div className="min-w-0">
                        <DialogTitle className="text-lg font-semibold tracking-tight">{title}</DialogTitle>
                        {description ? (
                            <DialogDescription className="mt-0.5 text-[12.5px]">{description}</DialogDescription>
                        ) : (
                            <DialogDescription className="sr-only">{title}</DialogDescription>
                        )}
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label="Fechar" className="-mr-1 -mt-1 text-muted-foreground">
                        <X className="size-4" />
                    </Button>
                </div>

                {/* O corpo: formulário rola, resumo fica */}
                <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                    <form
                        id={formId}
                        onSubmit={(e) => { e.preventDefault(); submit(false) }}
                        className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-x-3.5 gap-y-3 overflow-y-auto overscroll-contain px-5 pb-5 pt-4"
                    >
                        {children}
                    </form>
                    {summary ? (
                        <aside
                            aria-label="Como vai aparecer"
                            className="flex shrink-0 flex-col gap-3.5 border-t border-border bg-background p-4 md:w-[240px] md:border-l md:border-t-0"
                        >
                            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Como vai aparecer</p>
                            {summary}
                        </aside>
                    ) : null}
                </div>

                {/* Rodapé preso */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
                    <span className="hidden items-center gap-2 text-[11px] text-muted-foreground md:inline-flex">
                        <Kbd>Esc</Kbd> fecha
                        {submitLabel ? (
                            <>
                                <span className="opacity-50">·</span>
                                <Kbd>⌘</Kbd><Kbd>↵</Kbd> cria
                            </>
                        ) : null}
                        {submitLabel ? (
                            <>
                                <span className="opacity-50">·</span>
                                <span><span className="font-bold text-destructive-subtle-foreground">*</span> Campo obrigatório</span>
                            </>
                        ) : null}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                        {/* Sem ação primária o quadro é de leitura: um botão só,
                            e ele fecha. */}
                        {submitLabel ? (
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                                Cancelar
                            </Button>
                        ) : (
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                Fechar
                            </Button>
                        )}
                        {submitLabel && !hideAgain ? (
                            <Button type="button" variant="outline" onClick={() => submit(true)} disabled={submitting}>
                                {submitting && again ? <Loader2 className="animate-spin" /> : null}
                                Criar e novo
                            </Button>
                        ) : null}
                        {submitLabel ? (
                            <Button
                                type="submit"
                                form={formId}
                                variant={destructive ? 'destructive' : 'default'}
                                disabled={submitting || submitDisabled}
                            >
                                {submitting && !again ? <Loader2 className="animate-spin" /> : null}
                                {submitLabel}
                            </Button>
                        ) : null}
                    </span>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="num rounded border border-input bg-muted px-1.5 py-px font-sans text-[10.5px] text-muted-foreground">
            {children}
        </kbd>
    )
}

/** O cartão do resumo: a linha como vai aparecer na lista. */
export function SummaryCard({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5', className)}>
            {children}
        </div>
    )
}

/** O aviso amarelo do resumo — "parece já existir". */
export function SummaryNotice({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-lg bg-warning-subtle px-3 py-2.5 text-[11.5px] leading-relaxed text-warning-subtle-foreground">
            {children}
        </div>
    )
}
