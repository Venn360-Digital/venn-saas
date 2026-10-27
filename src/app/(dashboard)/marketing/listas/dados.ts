import type { PaginaDeIndice } from '@/lib/indice'

/** Uma lista de contatos como a tela a consome. */
export interface ListaItem {
    id: string
    name: string
    kind: string
    memberCount: number
    createdAt: string
}

export type DadosIniciais = PaginaDeIndice<ListaItem>
