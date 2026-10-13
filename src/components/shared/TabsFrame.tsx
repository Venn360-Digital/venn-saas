'use client'

import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface FrameTab {
    id: string
    label: string
    icon: LucideIcon
}

/**
 * O quadro das telas de guias — a Tela 03. Uma tela, várias guias: Conta
 * (perfil, empresa, usuários, integrações, automações, plano) e o que vier com
 * a mesma forma.
 *
 * A geometria é a da Tela 01, e de propósito: **linha 1 (50px)** com o nome da
 * tela à esquerda e a ação no canto direito — sempre no mesmo lugar, guia após
 * guia —, **linha 2 (46px)** com as guias no lugar onde as outras telas põem os
 * filtros, porque é ali que se escolhe o que se vê. As duas presas; a página
 * não rola, rola o conteúdo da guia.
 *
 * O corpo vai sobre o fundo tingido da marca com cartões brancos
 * (`SettingsCard`), que é a gramática do Dashboard — a Conta não inventa uma
 * terceira superfície.
 */
export function TabsFrame({
    title,
    tabs,
    active,
    onChange,
    actions,
    primary,
    fill = false,
    children,
    className,
}: {
    title: string
    tabs: FrameTab[]
    active: string
    onChange: (id: string) => void
    /** Ações secundárias da linha 1 — botões de contorno. */
    actions?: React.ReactNode
    /** A ação da guia aberta. Uma só, no canto — e só quando é da tela (criar),
        nunca o Salvar de um formulário, que vive junto do formulário. */
    primary?: React.ReactNode
    /** A guia ocupa a altura inteira e cuida da própria rolagem — uma tabela. */
    fill?: boolean
    children: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn('flex h-full min-h-0 flex-col', className)}>
            {/* Linha 1 */}
            <div className="flex h-[50px] shrink-0 items-center gap-2 bg-card px-4 md:px-6">
                <h1 className="truncate text-[17px] font-bold tracking-tight">{title}</h1>
                <span className="flex-1" />
                {actions}
                {primary ? <span className="ml-1 shrink-0">{primary}</span> : null}
            </div>

            {/* Linha 2 — as guias */}
            <div
                role="tablist"
                aria-label={title}
                className="flex h-[46px] shrink-0 items-center gap-6 overflow-x-auto border-b border-border bg-card px-4 md:px-6"
            >
                {tabs.map(({ id, label, icon: Icon }) => {
                    const on = id === active
                    return (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={on}
                            onClick={() => onChange(id)}
                            className={cn(
                                'relative flex h-[46px] shrink-0 items-center gap-2 whitespace-nowrap text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                                on ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <Icon className={cn('size-[15px]', on ? 'text-primary-subtle-foreground' : 'text-muted-foreground')} />
                            {label}
                            {on ? (
                                <span
                                    aria-hidden="true"
                                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-primary-subtle-foreground"
                                />
                            ) : null}
                        </button>
                    )
                })}
            </div>

            {/* O corpo da guia — o único que rola. Em `fill` quem rola é a guia
                (uma tabela com rodapé preso), e o corpo só dá a altura. */}
            {fill ? (
                <div className="flex min-h-0 flex-1 flex-col bg-background">{children}</div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background">
                    {/* Alinhado à esquerda, na mesma coluna do título: centralizar deixava
                        os cartões recuados em relação ao nome da tela. */}
                    <div className="w-full max-w-5xl px-4 py-4 md:px-6 md:py-5">{children}</div>
                </div>
            )}
        </div>
    )
}

/**
 * A barra de gravar de uma guia-formulário: o botão fica **junto do
 * formulário**, não na linha 1 — ali em cima ele parece agir sobre a tela
 * inteira, e numa tela de guias isso é justamente o que ele não faz.
 */
export function FormActions({ children, hint }: { children: React.ReactNode; hint?: string }) {
    return (
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {hint ? <p className="mr-auto text-xs text-muted-foreground">{hint}</p> : null}
            {children}
        </div>
    )
}

/**
 * Um grupo de campos dentro da guia: cartão branco sobre o fundo tingido, com
 * título e, quando ajuda, uma frase do que aquilo faz.
 */
export function SettingsCard({
    title,
    description,
    aside,
    footer,
    contentClassName,
    className,
    children,
}: {
    title?: string
    description?: string
    /** Do lado direito do título — uma busca, um selo, um estado. */
    aside?: React.ReactNode
    footer?: React.ReactNode
    /** `p-0` para conteúdo que desenha as próprias bordas, como uma tabela. */
    contentClassName?: string
    className?: string
    children: React.ReactNode
}) {
    return (
        <section className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
            {title || aside ? (
                <header className="flex items-start justify-between gap-3 px-5 pt-4">
                    <div className="min-w-0">
                        {title ? <h2 className="text-[13.5px] font-bold">{title}</h2> : null}
                        {description ? (
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
                        ) : null}
                    </div>
                    {aside ? <div className="shrink-0">{aside}</div> : null}
                </header>
            ) : null}
            <div className={cn('p-5', contentClassName)}>{children}</div>
            {footer ? (
                <div className="flex items-center justify-between gap-3 border-t border-border bg-background/60 px-5 py-3">
                    {footer}
                </div>
            ) : null}
        </section>
    )
}

/**
 * Uma linha de "o que é" + "o que fazer": o título, a explicação e a ação à
 * direita. É a forma das telas de ajuste — trocar o cartão, mudar o plano,
 * ligar uma rotina.
 */
export function SettingsRow({
    title,
    description,
    action,
    className,
}: {
    title: React.ReactNode
    description?: React.ReactNode
    action?: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">{title}</p>
                {description ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
                ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    )
}
