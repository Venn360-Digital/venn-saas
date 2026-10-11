import Link from 'next/link'

import { cn } from '@/lib/utils'

/**
 * Dados | Gráfico.
 *
 * Link, não estado: o painel é componente de servidor — os números já vêm no
 * HTML — e guardar a visão no cliente obrigaria a tela inteira a virar cliente
 * para lembrar de uma palavra. Na URL ela ainda sobrevive a um F5 e pode ser
 * mandada por mensagem com o recorte junto.
 */
export function ViewSwitch({
    view,
    hrefFor,
}: {
    view: 'dados' | 'grafico'
    hrefFor: (view: 'dados' | 'grafico') => string
}) {
    return (
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
            {(['dados', 'grafico'] as const).map((key) => (
                <Link
                    key={key}
                    href={hrefFor(key)}
                    scroll={false}
                    aria-current={key === view ? 'page' : undefined}
                    className={cn(
                        'rounded-md px-3 py-1 text-sm transition-colors',
                        key === view
                            ? 'bg-card font-semibold text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    {key === 'dados' ? 'Dados' : 'Gráfico'}
                </Link>
            ))}
        </div>
    )
}
