/**
 * O catálogo de passos de um funil, e a decisão de qual vem a seguir.
 *
 * Lógica pura: nenhuma consulta, nenhum binding, nada de plataforma. É a regra
 * da casa para o que decide — e aqui ela vale dobrado, porque o runtime vive
 * num Cloudflare Workflow e **o workerd não roda nesta máquina**. Se a decisão
 * morasse dentro do `WorkflowEntrypoint`, ela só poderia ser exercitada em
 * staging; aqui ela roda em `npx tsx`.
 */

/** O que um passo faz. */
export type TipoDePasso =
    | 'mensagem'
    | 'espera'
    | 'condicao'
    | 'etiquetar'
    | 'mover_etapa'
    | 'atribuir'
    | 'encerrar'

export const TIPOS_DE_PASSO: TipoDePasso[] = [
    'mensagem',
    'espera',
    'condicao',
    'etiquetar',
    'mover_etapa',
    'atribuir',
    'encerrar',
]

/** Por onde a mensagem de um passo sai. */
export type CanalDoPasso = 'whatsapp' | 'email'

export interface PassoDoFunil {
    id: string
    type: string
    config: unknown
    order: number
    edges: unknown
}

// ───────────────────────────── A espera ─────────────────────────────

/** Teto de uma espera: um ano, que é o limite do `step.sleep` do Workflows. */
export const ESPERA_MAX_MIN = 365 * 24 * 60

/**
 * Quantos minutos um passo de espera vale.
 *
 * `0` para o que não é espera ou está mal configurado — e zero é seguro: o
 * motor segue para o passo seguinte sem dormir. O contrário (tratar config
 * inválida como espera infinita) prenderia a pessoa no funil para sempre, e
 * ninguém notaria, porque o sintoma é ausência de mensagem.
 */
export function minutosDeEspera(config: unknown): number {
    const c = comoObjeto(config)

    const minutos = numero(c.minutos) ?? 0
    const horas = numero(c.horas) ?? 0
    const dias = numero(c.dias) ?? 0

    const total = minutos + horas * 60 + dias * 24 * 60
    if (!Number.isFinite(total) || total <= 0) return 0

    return Math.min(Math.floor(total), ESPERA_MAX_MIN)
}

// ──────────────────────────── A condição ────────────────────────────

/**
 * O que uma condição pode perguntar.
 *
 * Curto de propósito, e cada uma responde sobre **fatos do banco**, nunca sobre
 * texto gerado. Perguntar "o paciente demonstrou interesse?" seria pedir ao
 * modelo uma resposta que vira desvio de fluxo — e um desvio errado manda a
 * sequência inteira pelo caminho errado, em silêncio.
 */
export type CampoDeCondicao = 'respondeu' | 'tem_negocio_aberto' | 'tem_etiqueta' | 'etapa_do_negocio'

export interface Condicao {
    campo: CampoDeCondicao
    /** Para `tem_etiqueta` e `etapa_do_negocio`: qual. */
    valor?: string
}

export function lerCondicao(config: unknown): Condicao | null {
    const c = comoObjeto(config)
    const campo = texto(c.campo)
    if (
        campo !== 'respondeu' &&
        campo !== 'tem_negocio_aberto' &&
        campo !== 'tem_etiqueta' &&
        campo !== 'etapa_do_negocio'
    ) {
        return null
    }
    const valor = texto(c.valor)
    // Condição que precisa de alvo e não tem um não é condição.
    if ((campo === 'tem_etiqueta' || campo === 'etapa_do_negocio') && !valor) return null
    return { campo, valor }
}

// ──────────────────────────── A navegação ────────────────────────────

/**
 * Qual passo vem depois deste.
 *
 * `null` = fim do funil.
 *
 * ## As três formas, e por que nessa ordem
 *
 * 1. **Aresta explícita.** Uma condição manda por `sim`/`nao`; um passo comum
 *    pode ter `padrao` quando o desenho pulou alguém.
 * 2. **O próximo por ordem.** É o caso normal, e o que o canvas produz quando
 *    se empilham passos sem desviar nada.
 * 3. **Nada.** Fim.
 *
 * A aresta vence a ordem. O contrário faria o desenho do canvas mentir: a
 * pessoa liga dois nós com uma seta e o motor ignoraria a seta.
 */
export function proximoPasso(
    atual: PassoDoFunil,
    todos: PassoDoFunil[],
    ramo: 'sim' | 'nao' | 'padrao' = 'padrao'
): PassoDoFunil | null {
    const arestas = comoObjeto(atual.edges)
    const alvo = texto(arestas[ramo])

    if (alvo) {
        const achado = todos.find((p) => p.id === alvo)
        /**
         * Aresta apontando para passo que não existe **encerra**, e não cai no
         * próximo por ordem.
         *
         * Um passo apagado deixa arestas penduradas. Cair na ordem faria a
         * pessoa receber a mensagem de um passo que o desenho mandou pular — e
         * esse é o tipo de erro que só aparece no relato de um paciente.
         */
        return achado ?? null
    }

    /**
     * Num ramo de condição, a ausência de aresta é **fim**, não "siga em
     * frente".
     *
     * Uma condição com só o "sim" ligado significa que o "não" termina ali. Se
     * o "não" caísse no próximo por ordem, os dois ramos acabariam no mesmo
     * lugar e a condição não teria servido para nada.
     */
    if (ramo !== 'padrao') return null

    const ordenados = [...todos].sort((a, b) => a.order - b.order)
    const i = ordenados.findIndex((p) => p.id === atual.id)
    if (i < 0 || i + 1 >= ordenados.length) return null
    return ordenados[i + 1]
}

/** O primeiro passo do funil — o de menor `order`. */
export function primeiroPasso(todos: PassoDoFunil[]): PassoDoFunil | null {
    if (todos.length === 0) return null
    return [...todos].sort((a, b) => a.order - b.order)[0]
}

// ─────────────────────────────── Freios ───────────────────────────────

/**
 * Por que uma passagem para antes do fim.
 *
 * São os freios que o produto já tem escritos, e o funil **tem de** respeitá-los
 * — senão ele fala por cima do atendimento, que é a pior coisa que um
 * automatismo pode fazer num sistema onde gente de verdade atende.
 */
export type MotivoDeParada =
    | 'humano_assumiu'
    | 'optout'
    | 'funil_despublicado'
    | 'contato_removido'

export const TEXTO_DA_PARADA: Record<MotivoDeParada, string> = {
    humano_assumiu: 'Alguém da equipe assumiu a conversa',
    optout: 'O contato pediu para não receber mais',
    funil_despublicado: 'O funil foi despublicado',
    contato_removido: 'O contato não existe mais',
}

/** O estado do mundo que os freios consultam. */
export interface EstadoDoContato {
    /**
     * `Conversation.atendidaPor === 'humano'` — e **só** isso.
     *
     * Ver `deveParar` para por que não é `assignedTo`.
     */
    humanoAssumiu: boolean
    /** Opt-out do canal por onde o próximo passo sairia. */
    optOutNoCanal: boolean
    funilPublicado: boolean
    contatoExiste: boolean
}

/**
 * Deve parar? E por quê.
 *
 * ## O portão é `atendidaPor`, não `assignedTo`
 *
 * `assignedTo` **não** quer dizer que alguém assumiu: o rodízio o escreve na
 * chegada da mensagem (`lib/conversas/dono.ts`), então toda conversa
 * distribuída tem responsável. Parar por ele mataria o funil no instante em que
 * a conversa ganhasse dono — que é o caso normal.
 *
 * O produto já separou as duas coisas: **ter responsável** é uma coisa, **estar
 * com a equipe** é outra, e quem diz a segunda é `Conversation.atendidaPor ===
 * 'humano'`. É a mesma guarda que `servicos/entrega.ts` usa para decidir se a
 * conversa já foi entregue, e por onde o agente se cala.
 *
 * Esta função nasceu olhando `assignedTo` + `handoffAt`, que é a regra
 * **anterior** à troca do portão. Com ela, o funil pararia cedo demais em toda
 * clínica que usa distribuição automática.
 */
export function deveParar(estado: EstadoDoContato): MotivoDeParada | null {
    if (!estado.contatoExiste) return 'contato_removido'
    if (!estado.funilPublicado) return 'funil_despublicado'
    if (estado.humanoAssumiu) return 'humano_assumiu'
    if (estado.optOutNoCanal) return 'optout'
    return null
}

// ─────────────────────────────── Auxiliares ───────────────────────────

function comoObjeto(v: unknown): Record<string, unknown> {
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function texto(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined
}

function numero(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** O canal por onde um passo de mensagem sai. Padrão: WhatsApp. */
export function canalDoPasso(config: unknown): CanalDoPasso {
    return texto(comoObjeto(config).canal) === 'email' ? 'email' : 'whatsapp'
}

/** O texto de um passo de mensagem. */
export function textoDoPasso(config: unknown): string {
    return texto(comoObjeto(config).texto) ?? ''
}
