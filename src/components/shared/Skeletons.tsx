import { Skeleton } from '@venn/ui/skeleton'

/**
 * O esqueleto da tabela, e **só ele**.
 *
 * Este arquivo nasceu como "o vocabulário de espera, num lugar só": a espera era
 * expressa de três formas pelo app — `Loader2` em quinze arquivos,
 * `animate-pulse` em dois e o texto "Carregando..." em nove —, então a mesma
 * espera parecia coisa diferente em cada tela.
 *
 * **Tinha seis esqueletos; cinco saíram em 2026-11-09.** `CardGridSkeleton`,
 * `KpiRowSkeleton`, `FormSkeleton`, `ListSkeleton` e `InboxSkeleton` estavam
 * sem **nenhum** uso — uma biblioteca de geradores de campo fantasma esperando
 * alguém pegar. E alguém pegava: a "sombra de campos" voltou três vezes
 * (2026-10-26, 2026-11-05, 2026-11-09), e nas duas últimas vezes o conserto foi
 * tirar esqueleto de tela, não ajustar o que estava aqui. Código morto que só
 * sabe produzir o defeito recusado não fica de reserva.
 *
 * O que sobra é `TableSkeleton`, e ele passa na regra: a tabela de índice
 * **vai** aparecer, as colunas são conhecidas, e o `DataTable` só o desenha
 * depois do limiar de `useEsperaLonga`. Ver DESIGN.md §5, "carregando não
 * desenha conteúdo falso".
 *
 * Para espera nova, o vocabulário é: nada abaixo do limiar; acima dele, o
 * `Loader2` centrado. Não acrescente esqueleto aqui sem ler a regra.
 */

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
    return (
        <div className="divide-y divide-border">
            {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="flex items-center gap-4 px-4 py-3">
                    {Array.from({ length: cols }).map((_, c) => (
                        <Skeleton
                            key={c}
                            className="h-4"
                            // Varying widths so the block reads as rows of content
                            // rather than as a loading grid.
                            style={{ width: c === 0 ? '28%' : `${14 + ((r + c) % 3) * 6}%` }}
                        />
                    ))}
                </div>
            ))}
        </div>
    )
}
