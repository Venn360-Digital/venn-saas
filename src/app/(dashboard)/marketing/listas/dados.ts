import type { PaginaDeIndice } from '@/lib/indice'
import type { CanalDeCampanha } from '@/lib/marketing/apresentacao'

/** Uma lista de contatos como a tela a consome. */
export interface ListaItem {
    id: string
    name: string
    kind: string
    channel: CanalDeCampanha
    memberCount: number
    createdAt: string
}

export type DadosIniciais = PaginaDeIndice<ListaItem>
