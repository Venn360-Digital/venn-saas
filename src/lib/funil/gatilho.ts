/**
 * O que faz alguém entrar num funil.
 *
 * Lógica pura, pelo mesmo motivo de `passos.ts`: o runtime vive num Cloudflare
 * Workflow e o workerd não roda nesta máquina. O que decide é testável em
 * `npx tsx`; o que orquestra é casca fina.
 *
 * ## Por que o gatilho é chamada explícita, e não o outbox
 *
 * O projeto já tem um barramento de eventos — `src/lib/outbox` —, e seria
 * tentador pendurar o funil nele: um lugar só, nenhum ponto de chamada novo.
 * Não serve. O outbox é o canal de **tempo real para a tela**: ele carrega
 * "identificadores, nunca conteúdo", alguns tipos são declaradamente efêmeros,
 * e `podarOutbox` apaga o histórico. Um funil que não dispara porque o evento
 * foi podado, ou porque o tipo era efêmero, falharia do pior jeito possível —
 * em silêncio, sem mensagem nenhuma saindo, e o sintoma seria "o funil não
 * funciona" sem erro em log nenhum.
 *
 * Então quem escreve chama `talvezEntrarNoFunil`. O risco disso é ponto de
 * chamada esquecido, e é esse risco que `npm run check:gatilhos` cobre: todo
 * tipo declarado aqui precisa de pelo menos um ponto de disparo no código.
 */

/** Os quatro jeitos de entrar num funil. */
export type TipoDeGatilho =
    | 'etiqueta_aplicada'
    | 'etapa_do_negocio'
    | 'entrou_na_lista'
    | 'contato_criado'

export const TIPOS_DE_GATILHO: TipoDeGatilho[] = [
    'etiqueta_aplicada',
    'etapa_do_negocio',
    'entrou_na_lista',
    'contato_criado',
]

export const TEXTO_DO_GATILHO: Record<TipoDeGatilho, string> = {
    etiqueta_aplicada: 'Quando uma etiqueta for aplicada',
    etapa_do_negocio: 'Quando o negócio entrar numa etapa',
    entrou_na_lista: 'Quando o contato entrar numa lista',
    contato_criado: 'Quando um contato for criado',
}

/**
 * Os tipos que **exigem** um alvo, e por quê.
 *
 * "Quando o negócio mudar de etapa" sem dizer qual etapa dispararia a cada
 * movimento do quadro — e um funil de boas-vindas sairia quando o negócio
 * fosse marcado como perdido. `contato_criado` é o único sem alvo porque
 * criação não tem variedade: ou aconteceu, ou não.
 */
const EXIGEM_ALVO: ReadonlySet<TipoDeGatilho> = new Set([
    'etiqueta_aplicada',
    'etapa_do_negocio',
    'entrou_na_lista',
])

export interface Gatilho {
    tipo: TipoDeGatilho
    /** Qual etiqueta, qual etapa, qual lista. Ausente em `contato_criado`. */
    alvo?: string
}

/** O que aconteceu de fato, do lado de quem escreveu no banco. */
export interface EventoDeGatilho {
    tipo: TipoDeGatilho
    workspaceId: string
    contactId: string
    alvo?: string
}

/**
 * Lê o `Funnel.trigger` (Json) como gatilho, ou `null`.
 *
 * `null` é tratado como "este funil não entra ninguém" por quem chama — nunca
 * como "entra todo mundo". Json malformado virando curinga seria a pior
 * interpretação possível de um campo que a tela escreve.
 */
export function lerGatilho(trigger: unknown): Gatilho | null {
    const t = comoObjeto(trigger)
    const tipo = texto(t.tipo)
    if (!tipo || !(TIPOS_DE_GATILHO as string[]).includes(tipo)) return null

    const comoTipo = tipo as TipoDeGatilho
    const alvo = texto(t.alvo)
    if (EXIGEM_ALVO.has(comoTipo) && !alvo) return null

    return alvo ? { tipo: comoTipo, alvo } : { tipo: comoTipo }
}

/**
 * Este evento liga este gatilho?
 *
 * Comparação de alvo **exata**, sem normalizar caixa: os alvos são ids
 * (`tagId`, `stageId`, `listId`), não texto digitado. Comparar id sem distinguir
 * caixa seria afrouxar uma igualdade que já é exata e abrir a chance de dois
 * ids diferentes casarem.
 */
export function casa(gatilho: Gatilho, evento: EventoDeGatilho): boolean {
    if (gatilho.tipo !== evento.tipo) return false
    if (!EXIGEM_ALVO.has(gatilho.tipo)) return true
    return Boolean(gatilho.alvo) && gatilho.alvo === evento.alvo
}

// ───────────────────────────── Auxiliares ─────────────────────────────

function comoObjeto(v: unknown): Record<string, unknown> {
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function texto(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined
}
