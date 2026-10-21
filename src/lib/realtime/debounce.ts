/**
 * A decisão do debounce da resposta do agente, isolada da plataforma.
 *
 * **O que isto substitui.** Hoje o debounce vive no BullMQ
 * (`workers/src/services/ai-reply-schedule.ts`): um job atrasado por conversa,
 * chaveado por `reply-<conversationId>`, e cada mensagem nova chama
 * `changeDelay` para empurrar o disparo. É assim que três mensagens seguidas
 * geram **uma** resposta coerente em vez de três sobrepostas — e uma chamada de
 * LLM em vez de três.
 *
 * Cloudflare Queues não tem job atrasado reagendável. O equivalente é um
 * **alarme de Durable Object** por conversa: cada mensagem chama `setAlarm`, que
 * substitui o anterior. É um mapeamento mais limpo que o anterior — o BullMQ
 * exigia consultar o job, ler o estado e escolher entre `changeDelay`, `remove`
 * ou desistir; aqui é uma chamada.
 *
 * **Isto é função pura de propósito.** O Durable Object em si não roda nesta
 * máquina (o `workerd` exige macOS 13.5+), então toda a decisão mora aqui, onde
 * tem teste, e o objeto fica sendo uma casca que chama `setAlarm` com o que esta
 * função devolveu.
 */

export type EstadoDaConversa =
    /** Nada em andamento. Uma mensagem nova agenda a resposta. */
    | 'ocioso'
    /** A resposta está sendo gerada agora. */
    | 'gerando'

export interface SituacaoDoDebounce {
    agora: number
    /** O alarme já marcado, em epoch ms. Nulo quando não há. */
    alarmeAtual: number | null
    /**
     * Quando chegou a **primeira** mensagem desta rajada.
     *
     * Nulo quando não há rajada em curso. É o que permite o teto — ver
     * `TETO_DA_RAJADA_MS`.
     */
    inicioDaRajada: number | null
    /** Debounce da clínica + o atraso do slider, em ms. Ver `delayForSpeed`. */
    atrasoMs: number
    estado: EstadoDaConversa
}

export type DecisaoDoDebounce =
    /** Marcar o alarme para este instante. */
    | { acao: 'agendar'; para: number; inicioDaRajada: number }
    /** Não mexer. A resposta em curso já vai ler esta mensagem. */
    | { acao: 'nada'; motivo: 'gerando' | 'teto-da-rajada' }

/**
 * Até quando a rajada pode empurrar o disparo.
 *
 * **Isto conserta um defeito que o BullMQ também tem.** Com `changeDelay` a cada
 * mensagem e nenhum teto, quem manda mensagem a cada 3 s com debounce de 4 s
 * empurra a resposta **para sempre**: ela nunca dispara. Na prática ninguém digita
 * assim por muito tempo — mas uma sequência de notas de voz, um paciente ansioso
 * ou um bot do outro lado produzem exatamente esse padrão, e o sintoma é "o
 * agente não respondeu", sem erro em lugar nenhum.
 *
 * Trinta segundos contados da **primeira** mensagem da rajada. Passado isso, o
 * alarme não é mais empurrado: a resposta sai com o que houver, e a mensagem que
 * chegar depois começa uma rajada nova. Trinta segundos é mais que o maior
 * debounce configurável e menos que a paciência de quem está esperando.
 */
export const TETO_DA_RAJADA_MS = 30_000

/**
 * O que fazer quando uma mensagem chega.
 *
 * Pura: recebe a situação, devolve a decisão. Quem chama aplica.
 */
export function decidir(s: SituacaoDoDebounce): DecisaoDoDebounce {
    /**
     * Resposta sendo gerada: não mexe.
     *
     * O gerador carrega o histórico na hora de executar, então ele **vai** ler a
     * mensagem que acabou de chegar. Reagendar aqui produziria uma segunda
     * resposta à mesma pergunta. É a mesma conclusão do código atual, e vale
     * registrar o limite dela: uma mensagem que chegue nos últimos milissegundos
     * da geração pode não entrar: a janela existe e é estreita, e o custo de
     * fechá-la — travar a conversa durante a geração — é maior que o do sintoma.
     */
    if (s.estado === 'gerando') return { acao: 'nada', motivo: 'gerando' }

    const inicio = s.inicioDaRajada ?? s.agora

    // O teto: passado ele, o alarme já marcado é respeitado e não empurrado.
    if (s.alarmeAtual !== null && s.agora - inicio >= TETO_DA_RAJADA_MS) {
        return { acao: 'nada', motivo: 'teto-da-rajada' }
    }

    /**
     * O alarme nunca passa do teto, mesmo na primeira mensagem.
     *
     * Sem este `min`, um `atrasoMs` grande — o slider de velocidade da clínica
     * admite valores altos — já estouraria o teto de saída, e o teto deixaria de
     * significar o que diz.
     */
    const para = Math.min(s.agora + s.atrasoMs, inicio + TETO_DA_RAJADA_MS)

    return { acao: 'agendar', para, inicioDaRajada: inicio }
}
