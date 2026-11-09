import type { PaginaDeIndice } from '@/lib/indice'
import type { CanalDeCampanha } from '@/lib/marketing/apresentacao'

/** O estado de uma campanha, com rótulo em pt-BR. */
export const STATUS_CAMPANHA: Record<string, string> = {
    draft: 'Rascunho',
    scheduled: 'Agendado',
    running: 'Em progresso',
    done: 'Concluído',
    failed: 'Falhou',
    canceled: 'Cancelado',
}

/** A ordem dos filtros de status na barra. */
export const ORDEM_STATUS = ['draft', 'scheduled', 'running', 'done', 'failed', 'canceled'] as const

/** Uma campanha como a lista a consome. */
export interface CampanhaItem {
    id: string
    name: string
    labels: string[]
    status: string
    scheduledAt: string | null
    canal: CanalDeCampanha
    canalLabel: string
    /** O que a campanha manda: template no WhatsApp, assunto no e-mail. */
    conteudo: string
    /** Por onde sai: a linha no WhatsApp, o endereco do remetente no e-mail. */
    origem: string
    totalCount: number
    sentCount: number
    failedCount: number
    createdAt: string
}

export type DadosIniciais = PaginaDeIndice<CampanhaItem>
