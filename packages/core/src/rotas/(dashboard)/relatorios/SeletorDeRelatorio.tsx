import Link from 'next/link'
import { Download } from 'lucide-react'

import { cn } from '@venn/ui/utils'

/**
 * Qual relatório, e o botão de exportar.
 *
 * Componente de **servidor**: são links, não estado. Trocar de relatório navega
 * e o servidor recalcula — é o mesmo desenho do `ViewSwitch` do painel, e é o
 * que mantém o recorte no endereço para poder ser colado.
 *
 * O CSV também é um link (`<a download>` seria redundante: a rota manda
 * `Content-Disposition: attachment`). Um botão com `fetch` + `blob` precisaria
 * de cliente e perderia a única coisa que importa aqui — que o navegador cuide
 * do download sozinho.
 */

const ABAS = [
    { id: 'propostas', rotulo: 'Propostas' },
    { id: 'produtos', rotulo: 'Produtos' },
    { id: 'funil', rotulo: 'Funil' },
] as const

export function SeletorDeRelatorio({
    tipo,
    hrefDoTipo,
    hrefDoCsv,
}: {
    tipo: string
    hrefDoTipo: (proximo: 'propostas' | 'produtos' | 'funil') => string
    hrefDoCsv: string
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <nav
                aria-label="Qual relatório"
                className="inline-flex h-[30px] items-center rounded-full border border-input bg-card p-0.5"
            >
                {ABAS.map((aba) => {
                    const atual = aba.id === tipo
                    return (
                        <Link
                            key={aba.id}
                            href={hrefDoTipo(aba.id)}
                            aria-current={atual ? 'page' : undefined}
                            className={cn(
                                'rounded-full px-3 text-xs leading-[26px] transition-colors',
                                atual
                                    ? 'bg-primary-subtle text-primary-subtle-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {aba.rotulo}
                        </Link>
                    )
                })}
            </nav>

            <Link
                href={hrefDoCsv}
                prefetch={false}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-input bg-card px-3 text-xs text-foreground transition-colors hover:bg-accent"
            >
                <Download className="size-3.5" aria-hidden />
                Exportar CSV
            </Link>
        </div>
    )
}
