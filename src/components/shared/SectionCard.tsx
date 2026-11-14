import { cn } from '@venn/ui/utils'

interface SectionCardProps {
    title: string
    description?: string
    /** A control that belongs to the section, not to the page — e.g. "Adicionar". */
    action?: React.ReactNode
    footer?: React.ReactNode
    children: React.ReactNode
    className?: string
}

/**
 * A titled block inside a settings or wizard screen.
 *
 * The account tabs, the agent-creation tabs and the onboarding steps each built
 * this by hand, which is why their headings sat at three different sizes.
 */
export function SectionCard({
    title,
    description,
    action,
    footer,
    children,
    className,
}: SectionCardProps) {
    return (
        <section
            className={cn('rounded-lg border border-border bg-card', className)}
        >
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                    <h2 className="text-h3">{title}</h2>
                    {description ? (
                        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                    ) : null}
                </div>
                {action ? <div className="shrink-0">{action}</div> : null}
            </header>

            <div className="px-5 py-5">{children}</div>

            {footer ? (
                <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                    {footer}
                </footer>
            ) : null}
        </section>
    )
}
