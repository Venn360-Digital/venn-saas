import type { PaginaDeIndice } from '@venn/core/lib/indice'

/** Um funil como a listagem o consome. */
export interface FunilItem {
    id: string
    name: string
    description: string | null
    /** O `Funnel.trigger` cru — a frase sai de `frasedoGatilho`. */
    trigger: unknown
    status: string
    version: number
    maxAtivos: number | null
    passos: number
    /**
     * Os quatro desfechos, separados.
     *
     * `parados` ao lado de `concluidos` e não somado a eles: "parou porque
     * alguém atendeu" e "entregou a sequência inteira" contam histórias opostas
     * sobre o funil, e é a diferença entre as duas que diz se vale manter.
     */
    ativos: number
    concluidos: number
    parados: number
    falhos: number
    publishedAt: string | null
    updatedAt: string
}

export type DadosIniciais = PaginaDeIndice<FunilItem>
