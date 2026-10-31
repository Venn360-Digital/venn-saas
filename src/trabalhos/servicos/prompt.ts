import type { Agent } from '#prisma'
import type { ConversationContext } from './conversation-context'
import {
    type AgentPreferences,
    hasStoredPreferences,
    readAgentPreferences,
} from '@/types/agent-preferences'
import { semComentarios } from '@/lib/rag/secoes'
import { documentosDeProcedimento, documentosDoPrompt } from '@/lib/treinamento/documentos'
import { catalogoDeCenarios, lerCenarios, procedimentoParaOPrompt } from '@/lib/treinamento/cenarios'
import { resumoParaOPrompt } from '@/lib/conversas/resumo'

export interface KnowledgeChunk {
    title: string
    content: string
    similarity?: number
    /**
     * O tipo do trecho — `treinamento`, `cenario`, `doc`, `faq`, `website`.
     *
     * Existe para o prompt poder separar **fato** de **procedimento**: um fato
     * recuperado é fonte de verdade para responder, um procedimento é ordem de
     * execução. Sem a distinção, os passos de um cenário entrariam em "Base de
     * conhecimento" e o modelo os leria *para* o paciente em vez de executá-los.
     */
    type?: string
}

/**
 * As preferências do agente, com os defaults preenchidos.
 *
 * A forma vive em `@/types/agent-preferences`, junto com a tela e a API. A
 * interface local que existia aqui declarava `responseSpeed` como um enum de
 * texto enquanto a tela gravava segundos — e como ninguém comparava as duas, o
 * slider nunca teve efeito.
 */
export function readPreferences(agent: Agent): AgentPreferences {
    return readAgentPreferences(agent.preferences)
}

/**
 * Assemble the system prompt from the agent's configured persona plus any
 * retrieved knowledge.
 *
 * The old inline handler sent `agent.systemPrompt` alone, so everything the user
 * filled in on the Perfil/Trabalho/Preferências tabs — company name, job
 * description, tone, language — never reached the model, and the knowledge base
 * was written but never read.
 */
/**
 * A postura que cada função implica.
 *
 * `agentFunction` era gravado pela tela e lido por ninguém: o seletor
 * SDR/Vendas/Suporte não mudava uma vírgula da resposta. Aqui ele vira o que a
 * clínica espera que fosse — a diferença entre um agente que qualifica e agenda
 * e um que resolve e não empurra venda.
 */
const POSTURA: Record<string, string> = {
    sdr_atendimento:
        'Seu objetivo é entender o que a pessoa precisa e levá-la a agendar uma avaliação. ' +
        'Faça uma pergunta de cada vez, confirme o que entendeu e proponha horário quando fizer sentido.',
    vendas:
        'Seu objetivo é esclarecer dúvidas sobre tratamentos, valores e formas de pagamento, e fechar o agendamento. ' +
        'Seja direto sobre preço quando souber a informação, e nunca invente valor que não esteja na sua base.',
    suporte:
        'Seu objetivo é resolver a dúvida ou o problema de quem já é paciente. ' +
        'Não force venda: se a pessoa só precisa de uma informação, entregue a informação.',
}

/**
 * O rótulo legível de cada tom e idioma.
 *
 * Os seletores gravam o valor cru — `amigavel`, `pt-BR` — e ele ia direto para
 * dentro do prompt: "Tom de voz: amigavel. Responda sempre em pt-BR." O modelo
 * entende assim mesmo, mas é texto que ele lê, e vale escrever em português de
 * gente. Valor fora da lista passa como está, em vez de sumir.
 */
const TOM: Record<string, string> = {
    pratico: 'prático e objetivo',
    formal: 'formal e respeitoso',
    casual: 'casual e leve',
    amigavel: 'amigável e acolhedor',
    entusiasmado: 'entusiasmado',
}

const IDIOMA: Record<string, string> = {
    'pt-BR': 'português do Brasil',
    'en-US': 'inglês',
    'es-ES': 'espanhol',
    'fr-FR': 'francês',
}

/** Um documento de treinamento de modo `prompt`, como veio do banco. */
export interface DocumentoNoPrompt {
    slug: string
    content: string
}

/**
 * Os documentos de comportamento, na ordem de precedência, com a regra dita.
 *
 * **Por que a regra é dita e não só ordenada.** Os documentos vão se
 * contradizer: "Metodologia de venda" pede urgência, "Informações e privacidade"
 * proíbe prometer resultado, e o processo comercial manda conduzir ao
 * agendamento. Sem a precedência declarada, quem decide é a posição no texto —
 * ou seja, o acidente. Num produto de saúde isso não é detalhe de engenharia.
 *
 * `Instruções centrais` **substitui** `agent.systemPrompt` quando preenchido, em
 * vez de somar: os dois são o mesmo papel, e emitir ambos daria ao modelo duas
 * declarações de identidade que podem divergir — exatamente o defeito que o
 * método veio consertar.
 *
 * O comentário de HTML sai: `<!-- confirmar com a recepção -->` é nota de quem
 * escreve, e aqui ela entraria como instrução.
 */
function blocosDeTreinamento(docs: DocumentoNoPrompt[]): {
    instrucoesCentrais: string | null
    secoes: string[]
} {
    const porSlug = new Map<string, string>()
    for (const doc of docs) {
        const limpo = semComentarios(doc.content).trim()
        if (limpo) porSlug.set(doc.slug, limpo)
    }

    const instrucoesCentrais = porSlug.get('instrucoes-centrais') ?? null

    if (porSlug.size === 0) return { instrucoesCentrais: null, secoes: [] }

    const naOrdem = documentosDoPrompt().filter((d) => porSlug.has(d.slug))

    /**
     * A regra, escrita com os nomes que o admin vê na tela.
     *
     * Entra só quando há documento de treinamento: um agente que ainda não tem
     * nenhum **não ganha seção nenhuma** por causa disto.
     *
     * Note que "nenhuma seção nova" deixou de ser "byte a byte igual ao de
     * antes": a reordenação para o cache de prefixo move `Formato` para antes
     * das seções voláteis, e isso vale para todo agente, com ou sem `.md`. O
     * conteúdo é o mesmo; a ordem, de propósito, não.
     */
    /**
     * **A ordem inclui os Cenários, pelo nome, e isso era uma falta.**
     *
     * A lista saía de `documentosDoPrompt()`, que filtra modo `prompt`. Cenários
     * é modo `procedimento`, então ele **não aparecia em posição nenhuma** —
     * enquanto o corpo dele chega no bloco volátil, na posição de maior
     * recência, dizendo "execute os passos". Um procedimento pré-escrito era,
     * na prática, a instrução menos subordinada do conjunto.
     *
     * Ele entra pela precedência que o catálogo declara (4), ordenado junto dos
     * outros, e sem o texto: o que vai no prompt dele continua sendo só o
     * catálogo de títulos e gatilhos.
     */
    const comProcedimento = [...naOrdem, ...documentosDeProcedimento()].sort(
        (a, b) => a.precedencia - b.precedencia
    )

    const ordem = comProcedimento.map((d) => d.titulo)
    const precedencia =
        '## Precedência\n' +
        'Quando duas instruções suas se contradisserem, vale a que estiver mais ' +
        'alto nesta lista:\n' +
        ordem.map((titulo, i) => `${i + 1}. ${titulo}`).join('\n') +
        `\n${ordem.length + 1}. A base de conhecimento consultada durante a conversa\n` +
        'Nenhum objetivo comercial justifica contrariar um limite. Em dúvida, ' +
        'recuse com cuidado e diga que a equipe confirma.'

    const secoes = [precedencia]
    for (const doc of naOrdem) {
        // As centrais já foram para o topo, no lugar da instrução livre.
        if (doc.slug === 'instrucoes-centrais') continue
        secoes.push(`## ${doc.titulo}\n${porSlug.get(doc.slug)!}`)
    }

    return { instrucoesCentrais, secoes }
}

/**
 * O prompt de sistema, montado em **duas metades e nesta ordem**.
 *
 * ## Por que a ordem é parte do desenho, e não gosto
 *
 * O provedor desconta a parte do prompt que repete, mas só enquanto ela for
 * **prefixo exato** da chamada anterior. O desconto para no primeiro byte que
 * muda — e tudo depois dele é cobrado cheio, mesmo que seja idêntico.
 *
 * Até aqui as duas seções voláteis (`Base de conhecimento`, que vem da busca de
 * cada mensagem, e `Esta conversa`, que carrega o relógio) ficavam **no meio**,
 * com três seções estáveis atrás delas. O efeito é que nada era reaproveitado:
 * `Agendamento`, `O que você pode fazer` e `Formato` eram recobrados a cada
 * mensagem, e acima delas os documentos de treinamento — que num cliente real
 * passam de 50.000 caracteres — também.
 *
 * Então:
 *
 * - **`estaveis`** só pode conter o que não muda entre duas mensagens do mesmo
 *   atendimento: o que o admin escreveu, o cadastro da empresa, as fases do
 *   funil e o que o agente pode marcar. É o prefixo, e é o que fica em cache.
 * - **`volateis`** é a cauda: o relógio, quem está do outro lado, a fase deste
 *   negócio e os trechos recuperados do acervo.
 *
 * As duas listas existem separadas **no código** de propósito. Comentário
 * pedindo "mantenha a ordem" não impede ninguém de dar um `push` no lugar
 * errado; duas listas, sim — e o `test:prompt` prova que nenhuma seção estável
 * ficou depois de uma volátil.
 *
 * Efeito colateral bem-vindo: o acervo passa a ser a última coisa antes da
 * pergunta, que é onde ele é mais usado — e não no meio, com quatro seções de
 * instrução entre ele e o que o cliente perguntou.
 *
 * A única coisa que **não** melhorou de posição foi `Formato`: ela era a última
 * de todas e agora está no fim das estáveis, junto de `Quando não souber`. Perde
 * um pouco de recência e ganha o cache; e o que ela pede (mensagem curta, sem
 * markdown) nunca foi a instrução em disputa.
 */
export function buildSystemPrompt(
    agent: Agent,
    knowledge: KnowledgeChunk[] = [],
    context?: ConversationContext,
    treinamento: DocumentoNoPrompt[] = [],
    /**
     * O documento de Cenários, cru. **Parâmetro próprio, e não um item de
     * `treinamento`.**
     *
     * Se ele entrasse na lista de comportamento, `blocosDeTreinamento` o
     * emitiria inteiro no bloco estável — exatamente o que o modo
     * `procedimento` existe para evitar. Separado, só o catálogo sai daqui, e
     * é impossível somá-lo por acidente.
     */
    cenariosCru: string | null = null,
    /** O resumo compactado da conversa, quando houver. Entra antes da janela. */
    resumo: string | null = null
): string {
    const { instrucoesCentrais, secoes: deTreinamento } = blocosDeTreinamento(treinamento)

    /** O prefixo cacheável. Nada aqui pode depender da mensagem que chegou. */
    const estaveis: string[] = [instrucoesCentrais ?? agent.systemPrompt.trim()]
    /** A cauda. Muda a cada mensagem, por desenho. */
    const volateis: string[] = []

    /**
     * O resumo do que já aconteceu — a **primeira** volátil, e por isso ela está
     * aqui em cima e não perto do acervo.
     *
     * Volátil porque muda quando a compactação roda. Primeira porque é o
     * **passado**: tudo o que vem depois fala do agora — o relógio, quem está do
     * outro lado, o procedimento desta situação, os trechos desta pergunta. Pôr
     * o passado no fim faria o modelo ler o resumo como a última coisa dita, e
     * responder ao que foi combinado há trinta mensagens como se fosse novidade.
     */
    const passado = resumoParaOPrompt(resumo)
    if (passado) volateis.push(passado)

    estaveis.push(...deTreinamento)

    const company = [
        agent.companyName && `Nome: ${agent.companyName}`,
        agent.companySector && `Setor: ${agent.companySector}`,
        // O endereço da unidade deste agente. "Onde vocês ficam?" é das
        // perguntas mais frequentes numa clínica, e até aqui só tinha resposta
        // se alguém a tivesse escrito dentro das atribuições ou de uma FAQ.
        agent.companyAddress && `Endereço: ${agent.companyAddress}`,
        agent.companyWebsite && `Site: ${agent.companyWebsite}`,
        agent.companyDescription && `Sobre: ${agent.companyDescription}`,
    ].filter(Boolean)

    if (company.length > 0) {
        estaveis.push(`## Empresa\n${company.join('\n')}`)
    }

    const atribuicoes = [
        agent.agentFunction && POSTURA[agent.agentFunction],
        agent.jobDescription,
    ].filter(Boolean)

    if (atribuicoes.length > 0) {
        estaveis.push(`## Suas funções e atribuições\n${atribuicoes.join('\n\n')}`)
    }

    const style: string[] = []
    if (agent.voiceTone) style.push(`Mantenha um tom ${TOM[agent.voiceTone] ?? agent.voiceTone}.`)
    if (agent.language) style.push(`Responda sempre em ${IDIOMA[agent.language] ?? agent.language}.`)

    const prefs = readPreferences(agent)

    /**
     * A instrução sobre emoji só existe quando a clínica escolheu.
     *
     * Antes das preferências passarem a ser gravadas, `useEmojis` era sempre
     * indefinido e nenhuma das duas linhas entrava: o modelo decidia sozinho.
     * Sem esta guarda, o agente que já atende passaria a receber "Não utilize
     * emojis" por causa de um default nosso — mudança de tom que ninguém pediu.
     */
    if (hasStoredPreferences(agent.preferences)) {
        style.push(prefs.useEmojis ? 'Use emojis com moderação.' : 'Não utilize emojis.')
    }
    if (prefs.restrictTopics) {
        style.push(
            'Responda somente sobre assuntos relacionados à empresa e às suas atribuições. ' +
            'Para qualquer outro tema, recuse educadamente e retome o atendimento.'
        )
    }

    if (style.length > 0) {
        estaveis.push(`## Estilo de comunicação\n${style.join(' ')}`)
    }

    /**
     * O que o agente pode **fazer**, e não só dizer.
     *
     * A seção existe porque uma ferramenta sem contexto é chamada na hora errada:
     * sem a lista de fases, o modelo chuta um nome plausível que a clínica não
     * tem; sem a frase sobre agenda, ele promete marcar horário, que é
     * exatamente o que ele ainda não sabe fazer.
     *
     * **Estável**: as fases são do funil da conta, não deste atendimento. A fase
     * em que *este* negócio está vai na cauda, com o resto do que muda.
     */
    if (context && context.stages.length > 0) {
        estaveis.push(
            '## O que você pode fazer\n' +
            'Você tem ferramentas. Use-as quando a conversa pedir, e nunca invente o ' +
            'resultado delas.\n' +
            `As fases do funil desta clínica são, em ordem: ${context.stages.join(' → ')}. ` +
            'Ao mover o negócio, use o nome exato de uma delas.\n' +
            'Você consegue **consultar** compromissos já marcados.'
        )
    }

    /**
     * O catálogo de cenários: **título e gatilho, nada mais**.
     *
     * Estável de propósito, e é por isso que ele é só o catálogo. Os passos de
     * vinte cenários num prompt que vai em toda mensagem seriam milhares de
     * tokens para um agente que usa dois por dia. O título e o gatilho custam
     * ~30 tokens cada e fazem o agente **saber que o procedimento existe** —
     * divulgação progressiva, o padrão das Agent Skills.
     *
     * O corpo chega pela busca, na seção volátil "Procedimento para esta
     * situação", quando a conversa entra na situação.
     */
    if (cenariosCru) {
        /**
         * **`semComentarios` aqui, e isto era um furo aberto.**
         *
         * Os documentos de modo `prompt` são limpos na montagem dos blocos de
         * treinamento. Cenários não passa por ali: ele é separado em
         * `pecasDoPrompt` e chega **cru** neste parâmetro, de propósito, para
         * que só o catálogo saia dele.
         *
         * O efeito do furo era específico e ruim: `lerCenarios` captura a linha
         * inteira do `Quando:`, então um `Quando: o cliente pede desconto
         * <!-- confirmar: a partir de quanto -->` entrava no **bloco estável e
         * cacheado**, em toda mensagem de toda conversa. Comentário é nota de
         * quem escreve — nunca foi para o modelo em nenhum outro caminho, e não
         * podia ser neste.
         */
        const catalogo = catalogoDeCenarios(lerCenarios(semComentarios(cenariosCru)).cenarios)
        if (catalogo) estaveis.push(catalogo)
    }

    /**
     * Entregar, anotar e registrar o que não soube — as três que o passo 3 deu.
     *
     * **Estável, e fora do `if (context)` acima de propósito.** As outras
     * ferramentas dependem do cadastro da conta (as fases do funil, os
     * procedimentos marcáveis); estas três valem em qualquer clínica, inclusive
     * na que acabou de assinar e não cadastrou nada. Amarrá-las ao contexto
     * deixaria o agente de uma conta nova sem como escalar — exatamente a conta
     * em que escalar é mais provável.
     *
     * A ordem das frases é a ordem da precedência: entregar é a mais forte,
     * porque é a única irreversível pelo próprio agente.
     */
    estaveis.push(
        '## Quando a conversa passa de você\n' +
        'Use `passar_para_equipe` para entregar o atendimento a uma pessoa. Faça isso ' +
        'quando o paciente pedir para falar com alguém, quando houver dor ou urgência, ' +
        'quando for reclamação, e quando você já prometeu confirmar algo e não tem como. ' +
        '**Depois de chamar, você não responde mais nesta conversa** — então diga a frase ' +
        'que a ferramenta devolve e pare.\n' +
        'Use `nao_encontrei` quando a base de conhecimento desta conversa trouxe material ' +
        'e ainda assim não respondeu à pergunta. Chame junto de prometer a confirmação.\n' +
        'Use `anotar_paciente` para guardar o que vale para os próximos atendimentos: ' +
        'preferência, restrição, combinado ou como a pessoa quer ser chamada. Não anote ' +
        'o assunto de agora, que já está no histórico.'
    )

    /**
     * O que ele pode marcar, e com quem — ou que não pode marcar nada.
     *
     * As duas frases existem pelo mesmo motivo: sem nenhuma, o modelo decide
     * sozinho. Com a lista, ele oferece o que existe; sem nada liberado, ele
     * sabe dizer que a equipe retorna, em vez de prometer um horário que não
     * tem como marcar.
     *
     * **Estável**: procedimentos e especialistas são cadastro da conta.
     */
    if (context) {
        const { procedimentos, especialistas } = context.bookable
        if (procedimentos.length > 0 && especialistas.length > 0) {
            estaveis.push(
                '## Agendamento\n' +
                `Você pode marcar: ${procedimentos.join(', ')}.\n` +
                `Com: ${especialistas.join(', ')}.\n` +
                'Sempre consulte os horários livres antes de oferecer qualquer data, e marque ' +
                'só depois de o paciente confirmar qual horário quer. **Nunca invente horário** ' +
                'e nunca ofereça data que não tenha aparecido na consulta.\n' +
                'Para qualquer outro procedimento, ou qualquer pedido de remarcar ou cancelar, ' +
                'diga que vai passar para a equipe — você não faz isso.'
            )
        } else {
            estaveis.push(
                '## Agendamento\n' +
                'Você **não** marca, remarca nem cancela horário. Quando o paciente quiser um ' +
                'horário, diga que vai passar para a equipe e não prometa data nenhuma.'
            )
        }
    }

    // WhatsApp-specific shaping: long markdown answers read badly in a chat bubble.
    estaveis.push(
        '## Formato\n' +
        'Você está conversando pelo WhatsApp. Escreva mensagens curtas e diretas, ' +
        'sem markdown, sem títulos e sem listas numeradas longas.'
    )

    /**
     * O que fazer quando a resposta não está em lugar nenhum.
     *
     * **Estável, e isto foi um conserto.** A única instrução de recuo do sistema
     * vivia dentro de `## Base de conhecimento` — que só é emitida quando a busca
     * trouxe algo. Ou seja: exatamente no caso em que o recuo importa, quando o
     * acervo não devolveu nada, o modelo não recebia instrução nenhuma e decidia
     * sozinho o que dizer. Era o inverso do desejado, e invisível, porque o
     * agente responde de qualquer jeito — só responde inventando.
     *
     * Ser estável também é o certo para o cache: é texto que não muda entre
     * mensagens, e no bloco volátil ele custaria integral em toda resposta.
     *
     * As três proibições não são genéricas: preço, horário e prazo são as três
     * coisas que uma clínica não pode errar por escrito, e são as três que um
     * modelo preenche com plausibilidade quando não sabe.
     */
    estaveis.push(
        '## Quando não souber\n' +
        'Se a informação não estiver nas suas instruções nem na base de conhecimento ' +
        'desta conversa, diga que vai confirmar com a equipe e que retorna. Não ' +
        'responda por dedução.\n' +
        'Nunca invente valor, horário, prazo ou condição de pagamento. É melhor ' +
        'prometer confirmação do que acertar por sorte.\n' +
        'Se o paciente pedir para falar com uma pessoa, **chame `passar_para_equipe`** ' +
        'em vez de só dizer que vai passar. Dizer sem chamar deixa o paciente esperando ' +
        'alguém que não foi avisado.'
    )

    /**
     * O que o agente sabe sobre agora e sobre quem está do outro lado.
     *
     * A data é o item mais importante desta seção: um agente que agenda e não
     * sabe que dia é hoje não consegue interpretar "pode ser amanhã?" nem
     * perceber que a consulta de sexta já passou. O resto evita o vexame de
     * perguntar o nome de quem a clínica já atende, ou oferecer horário a quem
     * já tem consulta marcada.
     *
     * **Volátil, e a mais volátil de todas**: o relógio muda a cada mensagem,
     * então nenhuma seção estável pode vir depois desta.
     */
    if (context) {
        const linhas: string[] = [`Agora é ${context.agora}.`]

        if (context.contactFirstName) {
            linhas.push(
                `Você está falando com ${context.contactFullName}. ` +
                `Trate a pessoa por ${context.contactFirstName}, e não pergunte o nome dela de novo.`
            )
        } else {
            linhas.push('Você ainda não sabe o nome desta pessoa; pergunte com naturalidade na primeira oportunidade.')
        }

        if (context.dealStage) {
            linhas.push(`No funil da clínica, este atendimento está na fase "${context.dealStage}".`)
        }

        if (context.upcoming.length > 0) {
            const lista = context.upcoming.map((c) => `- ${c.quando}: ${c.titulo}`).join('\n')
            linhas.push(`Compromissos já marcados para esta pessoa:\n${lista}`)
            linhas.push('Não ofereça novo agendamento sem antes considerar o que já está marcado.')
        }

        volateis.push(`## Esta conversa\n${linhas.join('\n')}`)
    }

    /**
     * O acervo recuperado, por último.
     *
     * É a seção que muda mais a cada mensagem, e é a que mais se beneficia de
     * estar perto da pergunta: ficava com quatro blocos de instrução entre ela e
     * o que o cliente escreveu.
     */
    /**
     * **Procedimento e fato são seções diferentes, e a ordem é procedimento
     * primeiro.**
     *
     * O cenário diz o que fazer; o fato diz o que é verdade. Quando os dois
     * chegam na mesma recuperação — "quanto custa remarcar?" traz o preço e o
     * cenário de remarcação —, o procedimento tem de ser lido antes, senão o
     * modelo responde o fato e ignora a instrução de passar para a equipe.
     *
     * É também a precedência declarada no catálogo: Cenários é 4, Serviços e FAQ
     * são 7 e 8.
     */
    const procedimentos = knowledge.filter((c) => c.type === 'cenario')
    const fatos = knowledge.filter((c) => c.type !== 'cenario')

    const procedimento = procedimentoParaOPrompt(procedimentos)
    if (procedimento) volateis.push(procedimento)

    if (fatos.length > 0) {
        const corpus = fatos
            .map((chunk, i) => `[${i + 1}] ${chunk.title}\n${chunk.content}`)
            .join('\n\n')
        volateis.push(
            '## Base de conhecimento\n' +
            'Use os trechos abaixo como fonte de verdade para esta pergunta.\n\n' +
            corpus
        )
    }

    return [...estaveis, ...volateis].join('\n\n')
}
