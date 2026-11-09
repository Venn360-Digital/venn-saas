import type { PaginaDeIndice } from '@/lib/indice'
import type { RegistroDeDns } from '@/lib/marketing/remetentes'

/** Um remetente como a lista o consome. */
export interface RemetenteItem {
    id: string
    domain: string
    /** O endereço completo, já montado: `contato@clinica.com.br`. */
    from: string
    fromName: string
    replyTo: string
    status: string
    /** O estado cru do DKIM no SES, que diz *por que* ainda não verificou. */
    dkimStatus: string | null
    verifiedAt: string | null
    lastCheckedAt: string | null
    /** Os três CNAME que o cliente publica na zona do domínio dele. */
    dns: RegistroDeDns[]
    createdAt: string
}

export type DadosIniciais = PaginaDeIndice<RemetenteItem>
