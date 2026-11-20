import type { PaginaDeIndice } from '@venn/core/lib/indice'

/** Um formulário de captura como a lista o consome. */
export interface FormularioItem {
    id: string
    name: string
    /** `draft` | `published`. */
    status: string
    publicKey: string
    envios: number
    updatedAt: string
    createdAt: string
}

export type DadosIniciais = PaginaDeIndice<FormularioItem>
