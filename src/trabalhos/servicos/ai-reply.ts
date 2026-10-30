import type { Agent } from '#prisma'
import prisma from '@/lib/prisma'
import { LLMFactory } from '@/lib/llm/factory'
import { checkCredits, trackUsage } from '@/lib/llm/usage-tracker'
import type { LLMMessage, LLMProviderName, LLMResponse } from '@/types/llm'
import { montarConsulta, type MensagemDaConversa } from '@/lib/rag/consulta'
import { DocumentRetriever } from '@/lib/rag/retriever'
import { env } from '@/trabalhos/ambiente'
import { createLogger } from '@/trabalhos/registro'
import {
    buildSystemPrompt,
    readPreferences,
    type DocumentoNoPrompt,
    type KnowledgeChunk,
} from './prompt'
import { documentosDoPrompt } from '@/lib/treinamento/documentos'
import {
    carregarContextoDoEnsaio,
    loadConversationContext,
    type ConversationContext,
} from './conversation-context'
import { AGENT_TOOL_DEFINITIONS, runAgentTool, type AgentToolContext } from './agent-tools'

const log = createLogger('AI_REPLY')

export class OutOfCreditsError extends Error {
    constructor(workspaceId: string) {
        super(`Workspace ${workspaceId} has no AI credits left`)
        this.name = 'OutOfCreditsError'
    }
}

/**
 * Pull the knowledge chunks relevant to the latest question.
 *
 * Failure is non-fatal: answering without the knowledge base beats not answering.
 */
async function retrieveKnowledge(agentId: string, query: string): Promise<KnowledgeChunk[]> {
    if (env.AI_RAG_CHUNKS === 0 || !query.trim()) return []

    try {
        const retriever = new DocumentRetriever()
        const rows = await retriever.search(agentId, query, env.AI_RAG_CHUNKS)
        return rows
            .filter((row) => typeof row?.content === 'string')
            .map((row) => ({
                title: String(row.title ?? 'Documento'),
                content: String(row.content),
                similarity: typeof row.similarity === 'number' ? row.similarity : undefined,
            }))
    } catch (error) {
        log.warn(`knowledge retrieval failed for agent ${agentId}`, error)
        return []
    }
}

/**
 * Os documentos de comportamento do agente — os de modo `prompt`.
 *
 * Os de acervo não vêm por aqui: eles chegam por busca, quando a conversa pede.
 *
 * **Falha aqui NÃO é tolerada, e a assimetria com a busca é deliberada.**
 * `retrieveKnowledge` engole o erro porque responder sem a base de conhecimento
 * é responder sem um *fato* — chato, não perigoso. Estes documentos carregam os
 * **limites**: o que o agente não promete, o que ele não diagnostica, o que ele
 * encaminha para a equipe. Responder sem eles é responder como se não houvesse
 * limite, e num produto de saúde isso é pior do que não responder.
 *
 * Então o erro sobe: o job falha, a fila tenta de novo, e o paciente recebe uma
 * resposta atrasada em vez de uma resposta sem freio.
 */
async function carregarComportamento(agentId: string): Promise<DocumentoNoPrompt[]> {
    const slugs = documentosDoPrompt().map((d) => d.slug)
    return prisma.agentTrainingDoc.findMany({
        where: { agentId, slug: { in: slugs } },
        select: { slug: true, content: true },
    })
}

/**
 * `MensagemDaConversa` e nao `Message` do Prisma — a mesma forma minima que
 * `montarConsulta` usa.
 *
 * E o que permite ao console de ensaio passar turnos que **nao existem no
 * banco** por aqui, em vez de ter a propria versao desta conversao. Duas
 * versoes significariam o ensaio exercitando um historico montado de outro
 * jeito, e aí ele deixaria de provar o atendimento real.
 */
function toLlmHistory(history: MensagemDaConversa[]): LLMMessage[] {
    return history
        // Internal operator notes are not part of the customer-facing dialogue.
        .filter((m) => !m.isInternal && m.content.trim().length > 0)
        .map((m) => ({
            role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
            // Uma nota de voz transcrita vira texto para o modelo. Sem isto ele
            // via "🎵 Áudio" e respondia sem saber o que o paciente disse.
            content: m.contentType === 'audio' && m.transcript ? `[Nota de voz] ${m.transcript}` : m.content,
        }))
}


/**
 * O que o prompt precisa buscar, buscado uma vez.
 *
 * Separado de `montarMensagens` por causa do **paralelismo**: estas duas idas ao
 * banco não dependem do contexto da conversa, então rodam ao lado dele em vez de
 * depois. Juntar tudo numa função só custaria uma viagem em série no caminho
 * mais quente do sistema.
 */
interface PecasDoPrompt {
    knowledge: KnowledgeChunk[]
    comportamento: DocumentoNoPrompt[]
}

async function pecasDoPrompt(
    agent: Agent,
    historico: MensagemDaConversa[]
): Promise<PecasDoPrompt> {
    const consulta = montarConsulta(historico)
    const [knowledge, comportamento] = await Promise.all([
        retrieveKnowledge(agent.id, consulta),
        carregarComportamento(agent.id),
    ])
    return { knowledge, comportamento }
}

/**
 * As mensagens que vão ao modelo — **o mesmo texto no atendimento e no ensaio**.
 *
 * Esta função existe por uma razão só, e ela é o ponto todo do console de
 * ensaio: se o ensaio montasse o prompt por conta própria, ele passaria a provar
 * um prompt que ninguém usa. A primeira mudança em `buildSystemPrompt` separaria
 * os dois em silêncio, e o instrutor homologaria um agente que não existe.
 *
 * Então há uma montagem, e os dois caminhos passam por ela. O que difere entre
 * eles é de onde vêm o histórico e o contexto — não como o prompt é escrito.
 */
function montarMensagens(
    agent: Agent,
    historico: MensagemDaConversa[],
    context: ConversationContext | undefined,
    pecas: PecasDoPrompt
): LLMMessage[] {
    return [
        {
            role: 'system',
            content: buildSystemPrompt(agent, pecas.knowledge, context, pecas.comportamento),
        },
        ...toLlmHistory(historico),
    ]
}

export interface GenerateReplyInput {
    agent: Agent
    workspaceId: string
    conversationId: string
    /**
     * Responder sem ferramenta, para esticar o crédito que resta.
     *
     * Ferramenta multiplica as idas ao modelo por duas a três — é o que torna a
     * resposta boa e é o que custa mais. Com a carteira no fim, é a primeira
     * coisa a cair depois do áudio: o agente volta a responder só pelo que sabe,
     * em vez de emudecer. Ver a degradação em `processors/ai-reply.ts`.
     */
    semFerramentas?: boolean
}

export interface GeneratedReply {
    content: string
    usage: LLMResponse['usage']
}

/**
 * Produce the agent's next message for a conversation.
 *
 * Unlike the previous inline implementation this gates on the workspace's credit
 * balance first — the WhatsApp path used to consume LLM tokens with no limit
 * because only `/api/llm/generate` ever called `checkCredits`.
 */
/**
 * Quantas vezes o modelo pode pedir ferramenta antes de ser obrigado a falar.
 *
 * Cada volta é uma ida à OpenAI, cobrada do crédito da clínica. Três cobre o uso
 * real — consultar a agenda e mover o negócio na mesma conversa, com folga — e
 * fecha a porta para o laço em que o modelo chama a mesma ferramenta para sempre
 * porque não gostou da resposta.
 */
const MAX_RODADAS_DE_FERRAMENTA = 3

/**
 * Teto de tokens da resposta — e por que existir um.
 *
 * Até aqui `maxTokens` nunca era preenchido no caminho do atendimento: a única
 * contenção do tamanho era a frase de `## Formato` pedindo mensagem curta. Pedir
 * não é limitar — um modelo que decide escrever três parágrafos escreve, e o
 * paciente recebe no WhatsApp uma parede de texto que ninguém lê, cobrada por
 * token de saída, que é a metade caríssima da conta.
 *
 * 450 e não 300: o teto vale **também** para a rodada em que o modelo escreve os
 * argumentos da ferramenta em JSON, e cortar ali deixaria a chamada malformada.
 * Com ~3,5 caracteres por token em português, 450 dão ~1.575 caracteres — bem
 * acima do que uma resposta de WhatsApp precisa e do teto da fala
 * (`AGENT_SPEECH_MAX_CHARS`, 900).
 *
 * O teto **corta no meio da frase** quando é alcançado, e por isso
 * `finishReason` é registrado: resposta truncada tem de aparecer no rastro, não
 * virar um mistério na conversa.
 */
const TETO_DA_RESPOSTA = 450

export async function generateReply(input: GenerateReplyInput): Promise<GeneratedReply> {
    const { agent, workspaceId, conversationId } = input

    const credits = await checkCredits(workspaceId)
    if (!credits.hasCredits) throw new OutOfCreditsError(workspaceId)

    /**
     * "Manter contexto da conversa" decide quanto do fio o modelo vê.
     *
     * Ligado (o padrão), o modelo recebe as últimas `AI_HISTORY_LIMIT` mensagens.
     * Desligado, recebe só a última do paciente — cada mensagem é respondida como
     * se fosse a primeira. O interruptor existia na tela e não era lido por
     * ninguém; agora vale, e de quebra é o jeito de uma clínica cortar custo de
     * token num atendimento que não precisa de memória.
     */
    const prefs = readPreferences(agent)

    const recent = await prisma.message.findMany({
        where: { conversationId },
        // Newest messages matter most, so take from the end and restore chronology.
        orderBy: { createdAt: 'desc' },
        take: prefs.keepContext ? env.AI_HISTORY_LIMIT : 1,
    })
    const history = recent.reverse()

    /**
     * O que se procura no Cérebro é montado em `pecasDoPrompt`.
     *
     * Era `lastInbound.content` cru, e nota de voz procurava pela string
     * "🎵 Áudio" — busca vazia, atendimento sem base de conhecimento. Ver
     * `montarConsulta`, que também completa a pergunta curta com o que a pessoa
     * já disse.
     */

    // A busca na base e o contexto do paciente são independentes: duas idas ao
    // banco em paralelo custam o tempo da mais lenta, não a soma.
    const [context, pecas] = await Promise.all([
        loadConversationContext(conversationId, agent.timezone),
        pecasDoPrompt(agent, history),
    ])
    const { knowledge } = pecas

    const messages: LLMMessage[] = montarMensagens(agent, history, context, pecas)

    const llm = LLMFactory.create(agent.llmProvider as LLMProviderName, {
        model: agent.llmModel,
        temperature: agent.temperature,
        maxTokens: TETO_DA_RESPOSTA,
        /**
         * A chave do cache é **do agente**, não da conversa.
         *
         * O que se quer reaproveitar é o bloco estável do prompt — instruções,
         * documentos de comportamento, cadastro da empresa —, e ele é idêntico
         * em todas as conversas deste agente. Chavear por conversa jogaria fora
         * o acerto entre pacientes diferentes, que é a maioria do tráfego de uma
         * clínica.
         */
        promptCacheKey: `agente-${agent.id}`,
    })

    /**
     * O medidor conta **cada** ida ao modelo, não só a última.
     *
     * Uma conversa com ferramenta custa duas ou três chamadas, e cobrar só a
     * final daria à clínica um consumo que não bate com a fatura da OpenAI.
     */
    const total: LLMResponse['usage'] = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
    }
    const cobrar = async (resposta: LLMResponse, rodada: number) => {
        const { usage } = resposta
        total.promptTokens += usage.promptTokens
        total.completionTokens += usage.completionTokens
        total.totalTokens += usage.totalTokens
        total.cachedTokens = (total.cachedTokens ?? 0) + (usage.cachedTokens ?? 0)
        // Contabilizar não pode engolir uma resposta pronta: se o livro-caixa
        // falhar, o paciente ainda tem que receber o que foi gerado.
        try {
            await trackUsage(agent.llmProvider as LLMProviderName, agent.llmModel, usage, {
                workspaceId,
                agentId: agent.id,
                metadata: {
                    conversationId,
                    channel: 'whatsapp',
                    knowledgeChunks: knowledge.length,
                    toolRound: rodada,
                    /**
                     * Registrado por ida ao modelo, porque é por ida que o cache
                     * acerta ou não: a primeira rodada reaproveita o prefixo da
                     * mensagem anterior, e as rodadas de ferramenta
                     * reaproveitam o prefixo da própria resposta em curso.
                     */
                    finishReason: resposta.finishReason ?? null,
                },
            })
        } catch (error) {
            log.error(`usage tracking failed for workspace ${workspaceId}`, error)
        }
    }

    /**
     * Sem paciente resolvido, nenhuma ferramenta tem sobre quem agir.
     *
     * Acontece quando o contexto falhou de carregar — e aí o agente responde
     * pelo que sabe, em vez de chamar ferramenta sobre ninguém.
     */
    const toolContext: AgentToolContext | null = context.contactId
        ? {
              workspaceId,
              agentId: agent.id,
              conversationId,
              contactId: context.contactId,
              timezone: agent.timezone,
          }
        : null
    const ferramentas =
        toolContext && !input.semFerramentas ? AGENT_TOOL_DEFINITIONS : undefined

    let response = await llm.generate(messages, ferramentas)
    await cobrar(response, 0)

    for (
        let rodada = 1;
        toolContext && response.toolCalls?.length && rodada <= MAX_RODADAS_DE_FERRAMENTA;
        rodada++
    ) {
        // A decisão do modelo volta para o histórico antes dos resultados: sem
        // ela a API recusa as mensagens de papel `tool`, que precisam de uma
        // chamada à qual responder.
        messages.push({
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls,
        })

        for (const call of response.toolCalls) {
            const resultado = await runAgentTool(call.name, call.arguments, toolContext)
            /**
             * O log diz **o tamanho e se deu erro**, nunca o conteúdo.
             *
             * Eram os 80 primeiros caracteres do resultado — e o resultado de
             * `consultar_agenda_do_paciente` começa justamente pelo nome da
             * pessoa e pela data da consulta dela. Isso é dado de paciente no
             * log do Worker, que é o oposto do que a política de privacidade
             * exige. O que o log precisa responder é "a ferramenta rodou e
             * devolveu algo?", e para isso bastam o nome, o tamanho e o erro.
             */
            log.info(
                `tool ${call.name} on conversation ${conversationId}: ` +
                `${resultado.startsWith('Erro') ? 'erro' : 'ok'}, ${resultado.length} car.`
            )
            messages.push({ role: 'tool', content: resultado, toolCallId: call.id })
        }

        /**
         * Na última rodada o modelo responde **sem** ferramenta na mão.
         *
         * É o que garante que a conversa termina em texto para o paciente. Com as
         * ferramentas ainda oferecidas, um modelo em laço pediria mais uma e o
         * paciente ficaria sem resposta nenhuma.
         */
        const ultima = rodada === MAX_RODADAS_DE_FERRAMENTA
        response = await llm.generate(messages, ultima ? undefined : ferramentas)
        await cobrar(response, rodada)
    }

    if (response.finishReason === 'length') {
        // Não é erro de código: é o teto fazendo o que foi pedido. Mas a
        // resposta saiu cortada, e isso tem de ser visível — é o sinal de que o
        // teto ficou apertado para este agente.
        log.warn(
            `reply for conversation ${conversationId} hit the token ceiling ` +
            `(${TETO_DA_RESPOSTA}); the patient got a truncated message`
        )
    }

    log.info(
        `generated reply for conversation ${conversationId} ` +
        `(${total.totalTokens} tokens, ${total.cachedTokens ?? 0} em cache, ` +
        `${knowledge.length} chunks)`
    )

    return { content: response.content, usage: total }
}

/** Um turno do ensaio. `instrutor` é quem pergunta; `agente`, o que ele já respondeu. */
export interface TurnoDeEnsaio {
    de: 'instrutor' | 'agente'
    texto: string
}

export interface EnsaioInput {
    agent: Agent
    workspaceId: string
    /** Os turnos em ordem cronológica, terminando numa pergunta do instrutor. */
    turnos: TurnoDeEnsaio[]
}

export interface EnsaioResult {
    content: string
    usage: LLMResponse['usage']
    /** O que a busca trouxe, para o instrutor ver **por que** o agente respondeu aquilo. */
    trechos: KnowledgeChunk[]
    /** O texto com que se buscou — já expandido por `montarConsulta`. */
    consulta: string
    /** O prompt de sistema inteiro. É o artefato que explica a resposta. */
    prompt: string
}

/**
 * Uma resposta de ensaio: o instrutor pergunta, o agente responde, nada sai.
 *
 * ## O que isto é, e o que deliberadamente não é
 *
 * É o **mesmo** prompt e a **mesma** busca do atendimento real — por
 * `montarMensagens` e `pecasDoPrompt`, que o caminho do WhatsApp também usa. É
 * essa partilha que faz o ensaio valer como homologação; sem ela o instrutor
 * aprovaria um agente que não é o que atende.
 *
 * Não é um atendimento: não há conversa, não há contato, nada é gravado em
 * `Message` e nada é enviado por canal nenhum. E **não há ferramenta** — o
 * contexto do ensaio não tem `contactId` (ver `carregarContextoDoEnsaio`), então
 * o agente não move negócio nem marca consulta de ninguém durante o teste. O
 * preço é que a chamada de ferramenta não é exercitada aqui; o ganho é que o
 * instrutor pode conversar à vontade com um agente ligado à conta de produção.
 *
 * Consome crédito, por decisão do André: a interação gasta token do plano e isso
 * faz parte. Quem debita é a rota, uma vez por resposta entregue, como no
 * atendimento — ver `spendAiCredits`.
 */
export async function ensaiarResposta(input: EnsaioInput): Promise<EnsaioResult> {
    const { agent, workspaceId, turnos } = input

    const credits = await checkCredits(workspaceId)
    if (!credits.hasCredits) throw new OutOfCreditsError(workspaceId)

    /**
     * Os turnos viram a forma mínima de mensagem, sem passar pelo banco.
     *
     * `inbound` é o instrutor e `outbound` é o agente porque é assim que
     * `montarConsulta` e `toLlmHistory` leem direção — e o ensaio tem de ser
     * lido exatamente como uma conversa é.
     */
    const historico: MensagemDaConversa[] = turnos.map((t) => ({
        direction: t.de === 'instrutor' ? 'inbound' : 'outbound',
        content: t.texto,
        contentType: 'text',
    }))

    const [context, pecas] = await Promise.all([
        carregarContextoDoEnsaio(workspaceId, agent.timezone),
        pecasDoPrompt(agent, historico),
    ])

    const messages = montarMensagens(agent, historico, context, pecas)

    const llm = LLMFactory.create(agent.llmProvider as LLMProviderName, {
        model: agent.llmModel,
        temperature: agent.temperature,
        // O ensaio só vale como homologação se responder sob as mesmas
        // restrições do atendimento — o teto é uma delas.
        maxTokens: TETO_DA_RESPOSTA,
        promptCacheKey: `agente-${agent.id}`,
    })

    // Sem ferramenta, e portanto sem laço de rodadas: uma ida ao modelo.
    const response = await llm.generate(messages)

    try {
        await trackUsage(agent.llmProvider as LLMProviderName, agent.llmModel, response.usage, {
            workspaceId,
            agentId: agent.id,
            // `canal: 'ensaio'` é o que permite separar, no medidor, o que foi
            // teste do que foi atendimento de verdade.
            metadata: {
                channel: 'ensaio',
                knowledgeChunks: pecas.knowledge.length,
                finishReason: response.finishReason ?? null,
            },
        })
    } catch (error) {
        log.error(`usage tracking failed for workspace ${workspaceId}`, error)
    }

    log.info(
        `ensaio do agente ${agent.id}: ${response.usage.totalTokens} tokens, ` +
        `${pecas.knowledge.length} trechos`
    )

    return {
        content: response.content,
        usage: response.usage,
        trechos: pecas.knowledge,
        consulta: montarConsulta(historico),
        prompt: messages[0].content,
    }
}
