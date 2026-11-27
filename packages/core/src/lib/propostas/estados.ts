/**
 * A máquina de estado da revisão — as transições num lugar, não nas rotas.
 *
 * Puro e sem Prisma, para o `scripts/check-propostas.ts` poder percorrer o grafo
 * inteiro sem banco.
 *
 * ## O grafo
 *
 *     rascunho ──submeter──> em_aprovacao ──aprovar──> aprovada ──enviar──> enviada
 *        ^                        │                                           │
 *        │                        └──reprovar──> reprovada                    ├──> aceita
 *        │                                                                    ├──> recusada
 *        └────────── nova revisão (de reprovada, recusada ou expirada) ───────┴──> expirada
 *
 * `rascunho → enviada` direto é o caminho de hoje, e é o normal: alçada de
 * desconto é feature que entra quando alguém pedir, e exigir aprovação de uma
 * proposta que o próprio dono da clínica escreveu seria burocracia inventada.
 * Os três estados de aprovação existem no domínio para que acrescentar a tela
 * depois não precise de migração.
 *
 * ## Por que "voltar atrás" não é transição
 *
 * De `reprovada`, `recusada` ou `expirada` não se volta para `rascunho`: nasce
 * uma **revisão nova**. É a ideia central do módulo — a versão que o cliente
 * recebeu nunca muda, senão "qual versão ele aprovou?" fica sem resposta. Por
 * isso `podeTransicionar('recusada', 'rascunho')` é `false`, e quem precisa
 * disso chama `POST /revisoes`.
 */

/** Os oito estados. `String` no banco, união aqui — o domínio fechado vive no tipo. */
export const ESTADOS = [
    'rascunho',
    'em_aprovacao',
    'aprovada',
    'reprovada',
    'enviada',
    'aceita',
    'recusada',
    'expirada',
] as const

export type EstadoDaRevisao = (typeof ESTADOS)[number]

/**
 * O que pode virar o quê.
 *
 * Declarado como mapa e não como `switch` para que o teste possa iterar todos
 * os pares e provar que nenhuma transição apareceu por acidente.
 */
const TRANSICOES: Record<EstadoDaRevisao, readonly EstadoDaRevisao[]> = {
    // Enviar direto é o caminho de hoje; submeter existe para quando houver alçada.
    rascunho: ['em_aprovacao', 'enviada'],
    /**
     * `rascunho` é a **volta**, e ela não é enfeite.
     *
     * Sem ela, pedir aprovação é porta de mão única: a revisão só sai daqui
     * aprovada ou reprovada, e as duas são de alçada. Numa unidade onde quem
     * pediu é a única pessoa com alçada — a clínica de uma pessoa só, que este
     * produto atende —, o documento fica **preso para sempre**: não dá para
     * aprovar (quem pediu não decide), não dá para reprovar (mesma regra), não
     * dá para enviar e não dá para editar.
     *
     * Aconteceu na homologação do André em 27/11/2026, no primeiro documento
     * que ele montou. Ele descreveu como "não consigo aprovar, não consigo
     * enviar, preciso voltar pelo navegador para achar o editar" — os três
     * sintomas do mesmo beco.
     *
     * Cancelar o próprio pedido **não é auto-aprovação**: não produz registro
     * de aprovação nenhum, devolve a revisão para edição, e quem o faz é quem
     * pediu. Ver `avaliarGesto`.
     */
    em_aprovacao: ['aprovada', 'reprovada', 'rascunho'],
    aprovada: ['enviada'],
    // Terminais. A saída é revisão nova, não transição — ver o cabeçalho.
    reprovada: [],
    enviada: ['aceita', 'recusada', 'expirada'],
    aceita: [],
    recusada: [],
    expirada: [],
}

export function ehEstado(valor: string): valor is EstadoDaRevisao {
    return (ESTADOS as readonly string[]).includes(valor)
}

export function podeTransicionar(de: string, para: string): boolean {
    if (!ehEstado(de) || !ehEstado(para)) return false
    return TRANSICOES[de].includes(para)
}

export function transicoesDe(de: EstadoDaRevisao): readonly EstadoDaRevisao[] {
    return TRANSICOES[de]
}

/**
 * A revisão aceita itens novos?
 *
 * Só em rascunho. Submetida ou enviada, a lista está travada: é a revisão que
 * alguém está olhando ou que o cliente já tem na mão. A rota de itens responde
 * **409** nos outros estados, e não 400 — o pedido está bem formado, o estado é
 * que não permite.
 */
export function aceitaEdicaoDeItens(status: string): boolean {
    return status === 'rascunho'
}

/**
 * Pode nascer uma revisão nova a partir desta?
 *
 * Tudo menos `em_aprovacao`. Duas versões vivas ao mesmo tempo — uma esperando
 * alçada e outra sendo escrita — deixam a pergunta "qual vale?" sem resposta, e
 * é exatamente a pergunta que este módulo existe para responder.
 */
export function aceitaNovaRevisao(status: string): boolean {
    return ehEstado(status) && status !== 'em_aprovacao'
}

/** Já está fora de jogo: nem edita, nem envia, nem recebe aceite. */
export function ehTerminal(status: string): boolean {
    return ehEstado(status) && TRANSICOES[status].length === 0
}

/**
 * O rótulo em português, para a tela.
 *
 * Mora aqui junto do domínio porque estado sem rótulo vira `status.toUpperCase()`
 * espalhado em três componentes — e `EM_APROVACAO` não é texto de interface.
 * Nenhuma destas palavras é de nicho, então não passa pelo vocabulário.
 */
export const ROTULO_DO_ESTADO: Record<EstadoDaRevisao, string> = {
    rascunho: 'Rascunho',
    em_aprovacao: 'Em aprovação',
    aprovada: 'Aprovada',
    reprovada: 'Reprovada',
    enviada: 'Enviada',
    aceita: 'Aceita',
    recusada: 'Recusada',
    expirada: 'Expirada',
}

/** Os três tipos de documento. Mesmo ciclo de vida, rótulo e template diferentes. */
export const TIPOS_DE_DOCUMENTO = ['proposta', 'orcamento', 'contrato'] as const
export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number]

export function ehTipoDeDocumento(valor: string): valor is TipoDeDocumento {
    return (TIPOS_DE_DOCUMENTO as readonly string[]).includes(valor)
}

export const ROTULO_DO_TIPO: Record<TipoDeDocumento, string> = {
    proposta: 'Proposta',
    orcamento: 'Orçamento',
    contrato: 'Contrato',
}

/** O artigo certo, para frases montadas: "a proposta", "o orçamento". */
export const ARTIGO_DO_TIPO: Record<TipoDeDocumento, 'a' | 'o'> = {
    proposta: 'a',
    orcamento: 'o',
    contrato: 'o',
}
