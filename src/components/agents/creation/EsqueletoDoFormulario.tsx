import { Skeleton } from '@/components/ui/skeleton'

/**
 * O lugar do formulário enquanto o agente chega.
 *
 * Antes, carregar trocava a **tela inteira** por um disco girando: o nome do
 * agente, as quatro seções, o índice e o rodapé sumiam juntos, e dava para
 * jurar que a tela tinha se apagado — foi o que o Andre viu e relatou como
 * "os canais sumiram". A moldura agora fica de pé e só o miolo espera, que é
 * a única parte que de fato não se sabe ainda.
 *
 * O desenho imita o que vem depois — uma frase de apoio, uma linha de dois
 * campos, um bloco de texto —, para a tela não saltar quando o conteúdo
 * chegar.
 */
export function EsqueletoDoFormulario() {
    return (
        <div aria-busy="true" aria-live="polite" className="space-y-6">
            <span className="sr-only">Carregando o agente…</span>

            <div className="space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-80" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-9 w-full" />
                </div>
                <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-9 w-full" />
                </div>
            </div>

            <div className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-24 w-full" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-9 w-full" />
                </div>
                <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-9 w-full" />
                </div>
                <div className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-9 w-full" />
                </div>
            </div>
        </div>
    )
}
