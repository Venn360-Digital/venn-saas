import { z } from 'zod'

/**
 * As preferências de conversa do agente — uma definição só, para a tela, para a
 * API e para o worker.
 *
 * Existiam quatro cópias desta forma: o tipo do formulário em
 * `types/agent-creation.ts`, a interface local do `PreferenciasTab`, os defaults
 * do `useAgentCommands` e a interface do worker em `services/prompt.ts`. Nenhuma
 * delas se olhava, e foi assim que `responseSpeed` virou duas coisas
 * incompatíveis: a tela gravava um número de segundos e o worker esperava
 * `'instant' | 'fast' | 'natural' | 'slow'`, então o valor da tela nunca casava e
 * o atraso era sempre zero. O slider existia e não movia nada.
 *
 * O campo é um número de segundos agora, que é o que a tela sempre mostrou.
 */

/** Teto do atraso extra, igual ao `max` do slider. */
const MAX_RESPONSE_DELAY_SECONDS = 10

/** Quantas interações o agente aceita por atendimento, conforme a tela oferece. */
export const INTERACTION_LIMITS = [20, 25, 50, 100] as const

/**
 * Os nomes antigos do `responseSpeed`, para o caso de um agente ter sido gravado
 * com eles. Nenhuma rota chegou a gravar `preferences` — o campo era descartado
 * pelo zod antes de chegar ao banco — mas a rota de duplicação copiava o JSON
 * cru, então um valor herdado não é impossível.
 */
const LEGACY_SPEED_SECONDS: Record<string, number> = {
    instant: 0,
    fast: 1,
    natural: 3,
    slow: 8,
}

const responseSpeedSchema = z.preprocess((value) => {
    if (typeof value === 'string') return LEGACY_SPEED_SECONDS[value] ?? undefined
    return value
}, z.number().min(0).max(MAX_RESPONSE_DELAY_SECONDS))

export const agentPreferencesSchema = z.object({
    /** Envia "digitando…" ao canal enquanto o modelo trabalha. */
    showTypingIndicator: z.boolean(),
    /** Atraso extra, em segundos, somado ao debounce de entrada. */
    responseSpeed: responseSpeedSchema,
    /** Quando falso, o modelo responde só à última mensagem, sem histórico. */
    keepContext: z.boolean(),
    useEmojis: z.boolean(),
    /** Recusa assunto fora da empresa e das atribuições do agente. */
    restrictTopics: z.boolean(),
    /**
     * Respostas do agente por atendimento; ao estourar, a conversa vai para a
     * equipe. Zero significa sem limite — valor que a tela não oferece, e que
     * existe para o agente que nunca configurou preferência nenhuma.
     */
    interactionLimit: z.number().int().min(0).max(1000),
    /**
     * Dias de silêncio até a conversa ser finalizada sozinha. Zero é nunca.
     *
     * Era `CONVERSATION_AUTOCLOSE_HOURS`, do ambiente, igual para toda clínica
     * da instalação — e desligado, porque finalizar um fio ao qual o paciente
     * pode voltar é decisão de produto, não padrão de infraestrutura. Decisão de
     * produto é exatamente o que a clínica deve poder tomar, então virou
     * parâmetro do agente.
     *
     * Finalizar **recomeça o limite de respostas** do atendimento (ver
     * `closedAt`), então este campo é também o que garante que o limite se
     * renove numa clínica que não fecha conversa à mão.
     */
    autoCloseDays: z.number().int().min(0).max(365),
})

export type AgentPreferences = z.infer<typeof agentPreferencesSchema>

/**
 * O que um agente **novo** recebe gravado ao ser criado.
 *
 * `keepContext` nasce ligado porque um agente sem histórico responde cada
 * mensagem como se fosse a primeira.
 *
 * O limite de interações nasce em **20** desde 2026-10-15. Era 50, e passou por
 * 12 no mesmo dia — o caminho até 20 vale registrar, porque os dois extremos
 * estavam errados por motivos opostos.
 *
 * **Cinquenta era alto demais.** Uma conversa que precisou de cinquenta
 * respostas do robô já fracassou, e nessa escala a franquia de qualquer plano
 * consome 40% da mensalidade, contra os 10% que são o alvo.
 *
 * **Doze era baixo demais**, e o erro foi meu: eu dimensionei a válvula de
 * segurança com o número de um handoff que é de outra natureza. **São dois
 * handoffs diferentes.** O do AI SDR é sucesso — o lead foi qualificado e passa
 * para quem fecha, em torno de 18,5 mensagens trocadas (≈9,25 respostas do
 * agente, referência de mercado). Este limite aqui é válvula: existe para pegar
 * o fio **travado**, não o fio normal. Posto em 12, ficaria a 1,3x da média e
 * entregaria à equipe boa parte das conversas que estavam indo bem — o agente
 * viraria triador.
 *
 * Vinte fica a **2,2x** da média: pega o que de fato travou e deixa o resto
 * trabalhar. E o custo continua dentro do alvo mesmo no absurdo de *toda*
 * conversa ir até o limite — 5,4% a 7,5% da mensalidade nos três planos.
 */
export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
    showTypingIndicator: true,
    /** Cinco segundos: tempo de alguém lendo e digitando, não de um robô. */
    responseSpeed: 5,
    keepContext: true,
    useEmojis: true,
    /** Clínica responde de clínica: fora disso, recusa educadamente. */
    restrictTopics: true,
    interactionLimit: 20,
    /** Trinta dias de silêncio e o atendimento se encerra sozinho. */
    autoCloseDays: 30,
}

/**
 * O que um agente **já existente**, com a coluna `preferences` nula, se comporta
 * como: exatamente o que o código fazia antes destas preferências passarem a ser
 * lidas.
 *
 * Existe para que ligar o interruptor não mude, sozinho, o comportamento de um
 * agente que já está atendendo. Até a Fase 1, nenhuma rota conseguia gravar
 * `preferences` — o campo era descartado pela validação —, então *todo* agente
 * em produção tem a coluna nula. Se o fallback fosse o conjunto acima, o deploy
 * ligaria "digitando" em agentes no ar, acrescentaria "Não utilize emojis" ao
 * prompt deles e passaria a encerrar na quinquagésima resposta a conversa de um
 * paciente antigo — que acumula respostas na mesma linha, porque a conversa é
 * reaberta em vez de recriada.
 *
 * A clínica passa a valer o conjunto de cima no momento em que abre a aba
 * Preferências e salva, que é quando a escolha é dela.
 */
export const UNCONFIGURED_AGENT_PREFERENCES: AgentPreferences = {
    showTypingIndicator: false,
    responseSpeed: 0,
    keepContext: true,
    useEmojis: false,
    restrictTopics: false,
    /** Sem limite, como antes. */
    interactionLimit: 0,
    /**
     * Zero, e não 30: `CONVERSATION_AUTOCLOSE_HOURS` está desligado em
     * produção, então finalizar sozinho é comportamento que nenhum agente no
     * ar tem hoje. Ligá-lo no deploy começaria a encerrar conversa de
     * paciente sem a clínica ter escolhido isso. Passa a valer 30 quando ela
     * abrir Parâmetros do agente e salvar.
     */
    autoCloseDays: 0,
}

/** Se a clínica chegou a gravar preferência alguma para este agente. */
export function hasStoredPreferences(raw: unknown): boolean {
    return !!raw && typeof raw === 'object' && Object.keys(raw as object).length > 0
}

/** O que a API aceita num PATCH: qualquer subconjunto dos campos. */
export const agentPreferencesPatchSchema = agentPreferencesSchema.partial()

/**
 * Lê as preferências de um agente, preenchendo o que falta com os defaults.
 *
 * Tolerante por contrato: a coluna é `Json?` e pode conter o que uma versão
 * anterior gravou. Um campo inválido cai no default em vez de derrubar a
 * resposta ao paciente.
 */
export function readAgentPreferences(raw: unknown): AgentPreferences {
    if (!hasStoredPreferences(raw)) return UNCONFIGURED_AGENT_PREFERENCES

    // A base é o conjunto do agente não configurado, não o do agente novo: um
    // campo que a clínica nunca escolheu continua valendo o comportamento
    // anterior, mesmo que os vizinhos dele no JSON já tenham sido escolhidos.
    const result = { ...UNCONFIGURED_AGENT_PREFERENCES }
    const source = raw as Record<string, unknown>

    for (const key of Object.keys(agentPreferencesSchema.shape) as (keyof AgentPreferences)[]) {
        if (!(key in source)) continue
        const parsed = agentPreferencesSchema.shape[key].safeParse(source[key])
        if (parsed.success) {
            // O índice é a mesma chave dos dois lados; o TS não consegue
            // acompanhar a correlação num laço, e um objeto intermediário só
            // trocaria esta linha por uma asserção igual.
            ;(result as Record<string, unknown>)[key] = parsed.data
        }
    }

    return result
}
