import type { PaginaDeIndice } from '@venn/core/lib/indice'

/** Um template espelhado da Meta, como a tela o consome. */
export interface TemplateItem {
    id: string
    metaName: string
    language: string
    category: string
    status: string
    integrationId: string
    bodyVars: number
    headerVars: number
    syncedAt: string
}

/** Uma linha oficial disponível para sincronizar/escolher. */
export interface LinhaItem {
    integrationId: string
    label: string
    phoneNumber: string | null
}

export interface DadosIniciais {
    pagina: PaginaDeIndice<TemplateItem>
    linhas: LinhaItem[]
}
