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

    /**
     * Minutos de silêncio até o agente perguntar se a pessoa ainda está aí.
     * Zero é nunca.
     *
     * ## O vazio que isto preenche
     *
     * Havia um só prazo de inatividade, `autoCloseDays`, e ele **fecha calado**:
     * trinta dias depois a conversa é finalizada sem ninguém dizer nada a quem
     * estava do outro lado. Entre a última mensagem e esse silêncio de um mês
     * não havia nada — nem uma tentativa de retomar, nem uma despedida.
     *
     * A clínica pediu as duas: "quando o paciente parar de interagir, tem como
     * ela fazer algumas perguntas para saber se ele ainda quer conversar" e, não
     * voltando, "devido à falta de interação, vou encerrar o atendimento".
     *
     * ## Por que minutos, e não dias
     *
     * Porque é a mesma conversa. Quem perguntou o preço e parou de responder
     * está com o celular na mão agora; retomar amanhã é começar outra coisa. A
     * unidade do `autoCloseDays` é dia porque ele responde outra pergunta —
     * "este atendimento morreu?" — e as duas réguas convivem: esta cutuca
     * dentro do turno, aquela varre o que ficou para trás.
     */
    inactivityNudgeMinutes: z.number().int().min(0).max(10_080),

    /**
     * Minutos **depois da cutucada** até a despedida e o encerramento. Zero é
     * nunca encerrar por inatividade.
     *
     * Contado da cutucada, e não da última mensagem do paciente, porque é o que
     * a régua quer dizer: deu-se uma chance de responder, e ela não foi usada.
     * Contado do silêncio original, mudar a primeira régua mudaria a segunda sem
     * ninguém pedir.
     */
    inactivityCloseMinutes: z.number().int().min(0).max(43_200),
})

export type AgentPreferences = z.infer<typeof agentPreferencesSchema>

/**
 * **Saiu `keepContext`**, e não era uma opção — era um defeito com interruptor.
 *
 * Desligado, o modelo recebia `take: 1` em vez das `AI_HISTORY_LIMIT` últimas
 * mensagens. Três consequências, e a terceira é a que condena:
 *
 *   1. "e quanto custa?" perde o referente, porque a pergunta anterior não está
 *      mais lá;
 *   2. `montarConsulta` deixa de completar a pergunta curta com o que a pessoa
 *      já disse — é a expansão que faz a busca encontrar algo;
 *   3. `take: 1` pega a última mensagem **de qualquer direção**. Se essa for do
 *      agente — a saudação `initialMessage`, ou uma mensagem de regra —, o
 *      filtro de `inbound` esvazia a lista: **busca vazia e prompt sem a fala do
 *      paciente**. Atendimento sem base de conhecimento nenhuma, sem nada na
 *      tela indicando isso.
 *
 * A única razão de existir era custo de token, e ela não se sustenta: vinte
 * mensagens de WhatsApp são 600 a 1.000 tokens, duas ordens de grandeza longe de
 * importar — e o bloco estável do prompt já é cobrado com desconto de cache.
 * Conversa longa é problema de compactação, não de desligar a memória.
 *
 * **Nada cai no banco.** `preferences` é JSON e `readAgentPreferences` faz merge
 * por chave: a chave gravada em agente antigo simplesmente deixa de ser lida.
 */

/**
 * O que um agente **novo** recebe gravado ao ser criado.
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
 * Vinte ficava a **2,2x** da média: pegava o que de fato travou e deixava o
 * resto trabalhar, com custo de 5,4% a 7,5% da mensalidade no absurdo de *toda*
 * conversa ir até o limite.
 *
 * **Hoje são 50, por decisão do Andre.** Ele pediu explicitamente este valor
 * para a conta que acaba de nascer, e o número vale para todo agente novo em
 * vez de só para o primeiro — dois limites diferentes para a mesma tela seriam
 * lidos como defeito na primeira vez que ele criasse o segundo agente. O que
 * isto custa, para ficar escrito e não ser redescoberto: a 50 respostas por
 * atendimento o pior caso sai dos ~7% e vai para a casa dos 40% da mensalidade
 * em custo de IA, contra os 10% que são o alvo do §12 do PRODUCT.md. Não é
 * gasto garantido — é o teto do pior caso, e conversa que chega a 50 respostas
 * do robô é rara —, mas é o teto que a válvula passa a permitir.
 */
export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
    showTypingIndicator: true,
    /** Cinco segundos: tempo de alguém lendo e digitando, não de um robô. */
    responseSpeed: 5,
    useEmojis: true,
    /** Clínica responde de clínica: fora disso, recusa educadamente. */
    restrictTopics: true,
    interactionLimit: 50,
    /** Trinta dias de silêncio e o atendimento se encerra sozinho. */
    autoCloseDays: 30,
    /**
     * Meia hora, e depois um dia.
     *
     * Meia hora porque é a janela em que a pessoa ainda está na conversa: quem
     * perguntou o preço e parou costuma ter saído para pensar, não para sempre.
     * Mais curto viraria cobrança; mais longo chegaria quando ela já fechou o
     * aplicativo e esqueceu.
     *
     * Um dia depois para a despedida, e não duas horas, porque encerrar é
     * irreversível do ponto de vista de quem lê: a última coisa que a clínica
     * disse foi "vou encerrar". Vinte e quatro horas cobrem quem respondeu à
     * noite, quem trabalha de dia e quem simplesmente demorou — e o fio reabre
     * sozinho se a pessoa voltar depois.
     */
    inactivityNudgeMinutes: 30,
    inactivityCloseMinutes: 24 * 60,
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
    /**
     * Zero nos dois, pelo mesmo motivo de `autoCloseDays` — e aqui o motivo
     * pesa mais: estas duas réguas **escrevem para o paciente**. Ligá-las num
     * deploy faria agentes no ar começarem a perguntar "ainda está aí?" e a
     * encerrar atendimentos sem a clínica ter escolhido nada disso.
     */
    inactivityNudgeMinutes: 0,
    inactivityCloseMinutes: 0,
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
