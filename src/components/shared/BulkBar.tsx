'use client'

import { Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * O conteúdo da barra de lote — o rodapé escuro que substitui a paginação
 * enquanto há linhas marcadas. Vai em `DataTable bulkActions`.
 *
 * É um componente só para que a barra seja igual em todas as telas de índice:
 * a contagem à esquerda, as ações da tela no meio, Excluir por último antes do
 * espaço, e o × que desmarca tudo no canto. O botão é fantasma com a tinta do
 * fundo invertida porque a barra é `foreground`.
 */
export function BulkBar({
    count,
    noun,
    feminine = false,
    children,
    onDelete,
    onClear,
}: {
    count: number
    /** `['paciente', 'pacientes']` — para "3 pacientes selecionados". */
    noun: [string, string]
    /** "2 etiquetas selecionadas", não "selecionados". */
    feminine?: boolean
    /** As ações próprias da tela (Exportar…), antes do Excluir. */
    children?: React.ReactNode
    onDelete?: () => void
    onClear: () => void
}) {
    const one = count === 1
    return (
        <>
            <span className="num mr-2 text-xs font-semibold">
                {count} {one ? noun[0] : noun[1]} selecionad{feminine ? 'a' : 'o'}{one ? '' : 's'}
            </span>
            {children}
            {onDelete ? (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-background hover:bg-background/10 hover:text-background"
                    onClick={onDelete}
                >
                    <Trash2 className="size-3.5" /> Excluir
                </Button>
            ) : null}
            <span className="flex-1" />
            <Button
                variant="ghost"
                size="icon-sm"
                className="text-background hover:bg-background/10 hover:text-background"
                onClick={onClear}
                aria-label="Limpar seleção"
            >
                <X className="size-4" />
            </Button>
        </>
    )
}

/** Apaga um a um e conta os que deram certo. */
export async function deleteEach(ids: string[], url: (id: string) => string) {
    let ok = 0
    for (const id of ids) {
        try {
            const res = await fetch(url(id), { method: 'DELETE' })
            if (res.ok) ok++
        } catch {
            /* conta como falha */
        }
    }
    return ok
}
