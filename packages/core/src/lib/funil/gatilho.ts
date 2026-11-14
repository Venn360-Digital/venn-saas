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

/** Os jeitos de entrar num funil. */
export type TipoDeGatilho =
    | 'etiqueta_aplicada'
    | 'etapa_do_negocio'
    | 'entrou_na_lista'
    | 'contato_criado'
    | 'negocio_ganho'
    | 'negocio_perdido'
    | 'clicou_na_campanha'
    | 'manual'

export const TIPOS_DE_GATILHO: TipoDeGatilho[] = [
    'etiqueta_aplicada',
    'etapa_do_negocio',
    'entrou_na_lista',
    'contato_criado',
    'negocio_ganho',
    'negocio_perdido',
    'clicou_na_campanha',
    'manual',
]

export const TEXTO_DO_GATILHO: Record<TipoDeGatilho, string> = {
    etiqueta_aplicada: 'Quando uma etiqueta for aplicada',
    etapa_do_negocio: 'Quando o negócio entrar numa etapa',
    entrou_na_lista: 'Quando o contato entrar numa lista',
    contato_criado: 'Quando um contato for criado',
    negocio_ganho: 'Quando um negócio for marcado como ganho',
    negocio_perdido: 'Quando um negócio for marcado como perdido',
    clicou_na_campanha: 'Quando clicar num link de campanha de e-mail',
    manual: 'Só quando alguém puser o contato aqui',
}

/**
 * O que cada gatilho serve, dito para quem monta o funil.
 *
 * Mora junto do tipo e não na tela: é a diferença entre dois gatilhos que
 * parecem iguais e levam a funis opostos, e essa diferença não pode existir só
 * na cabeça de quem escreveu o código.
 */
export const AJUDA_DO_GATILHO: Record<TipoDeGatilho, string> = {
    etiqueta_aplicada:
        'O jeito mais controlado de pôr gente num funil: você escolhe quem, aplicando a etiqueta.',
    etapa_do_negocio:
        'Dispara ao entrar na etapa escolhida — não a cada salvamento do cartão, só na mudança.',
    entrou_na_lista:
        'Entra quem for acrescentado à lista. Lista recebe gente em lote, então o teto de ativos é obrigatório aqui.',
    contato_criado:
        'Cadastro novo, um por um. Importação de planilha NÃO dispara, de propósito: um CSV antigo mandaria boas-vindas para quem já é cliente há anos.',
    negocio_ganho:
        'Pós-venda: agradecer, pedir indicação, combinar o retorno. Dispara uma vez por fechamento, não a cada edição do cartão fechado.',
    negocio_perdido:
        'Recuperação: entender o motivo, guardar para depois, reabordar mais tarde. Reabrir e perder de novo dispara de novo — é um fechamento novo.',
    clicou_na_campanha:
        'Quem clicou demonstrou interesse. Serve para separar quem reage de quem só recebe, qualquer que seja a campanha.',
    manual:
        'Nada dispara sozinho: o funil só recebe quem for posto nele à mão, da ficha do contato. Use quando o critério é seu e não cabe em regra.',
}

/**
 * Os tipos que **exigem** um alvo, e por quê.
 *
 * "Quando o negócio mudar de etapa" sem dizer qual etapa dispararia a cada
 * movimento do quadro — e um funil de boas-vindas sairia quando o negócio
 * fosse marcado como perdido.
 *
 * Os outros não têm alvo porque não têm variedade a recortar: criação, ganho,
 * perda e entrada manual aconteceram ou não aconteceram. `clicou_na_campanha`
 * é o caso que **poderia** ter (clicou em qual campanha?) e deliberadamente não
 * tem: o uso real é separar quem reage de quem só recebe, e amarrar o funil a
 * uma campanha específica o deixaria morto no dia seguinte ao disparo dela.
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
    /**
     * Restringe a entrada a **um** funil, pelo id.
     *
     * Só a entrada manual usa isto, e ela precisa: os outros gatilhos descrevem
     * um fato do mundo ("a etiqueta foi aplicada") e é correto que todo funil
     * que escute aquele fato receba a pessoa. "Alguém apertou o botão" não é um
     * fato do mundo — é uma ordem, e ela tem destinatário. Sem este campo, pôr
     * um contato num funil manual o poria em todos os funis manuais da unidade
     * de uma vez.
     *
     * Não é o `alvo`: `alvo` é o que o gatilho compara (qual etiqueta, qual
     * etapa) e é escolhido por quem **monta** o funil; isto é escolhido por quem
     * **dispara**, e é por isso que mora fora do `casa()`.
     */
    apenasFunil?: string
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
