/**
 * O catálogo dos documentos de treinamento do agente — a espinha do método.
 *
 * O treinamento deixa de ser uma dúzia de campos avulsos e passa a ser **oito
 * documentos em Markdown**, cada um com um assunto e um lugar de atuação. Tudo o
 * mais pendura aqui: a tela desenha a partir deste catálogo, o indexador sabe o
 * que vetorizar por ele, e o construtor de prompt monta a ordem por ele.
 *
 * **Por que Markdown.** Não é estética: cabeçalho é metadado. Com `##` o corte
 * do acervo acontece onde o autor já cortou, e cada trecho recuperado carrega o
 * caminho da seção ("Serviços › Ortodontia › Preço") — ver `src/lib/rag/secoes.ts`.
 * Um campo de texto corrido não dá nada disso.
 *
 * **A decisão mais importante está em `modo`, e ela não é do admin.**
 *
 * Mandar os oito documentos no prompt a cada mensagem seria trocar ~2 mil tokens
 * por ~12 mil, e isso piora de duas formas ao mesmo tempo: o modelo atende pior
 * ao **meio** de um contexto longo, então a regra de preço enterrada no meio de
 * 12 mil tokens fica *menos* confiável do que está hoje; e a conta cai inteira
 * na margem, porque o crédito do cliente é por ação entregue, não por consumo.
 *
 * Então cada documento tem um modo fixo:
 *
 *   - `prompt` — comportamento. Vai **sempre**, porque não pode depender de a
 *     busca acertar. Tem teto de caracteres, e o teto é a parte que protege: sem
 *     ele, o primeiro admin que colar um manual de cinquenta páginas em
 *     Instruções centrais degrada todas as respostas da conta sem ninguém
 *     entender por quê.
 *   - `rag` — fato consultável. Entra por similaridade, quando a conversa pede.
 *     Teto largo, porque trecho não recuperado não custa contexto.
 *
 * A tela **diz o modo no campo**. É o que ensina onde escrever o quê, em vez de
 * deixar a pessoa descobrir pelo resultado.
 */

import { modeloEscrito } from './modelos'
import { vocab } from '../vocabulario'
import { comArtigo } from '../concordancia'

/**
 * Onde o texto do documento chega ao modelo.
 *
 *   - `prompt`: inteiro, em toda mensagem. Carrega identidade e limites.
 *   - `rag`: por busca, quando a conversa pede. Carrega fatos.
 *   - `procedimento`: **catálogo no prompt, corpo por busca.** É divulgação
 *     progressiva — o agente sabe que o procedimento existe sem carregá-lo, e o
 *     corpo entra quando a conversa chega nele. Ver `lib/treinamento/cenarios.ts`.
 *
 * `procedimento` é indexado como `rag` (o indexador só pula `prompt`), mas o
 * trecho leva `type: 'cenario'` em vez de `treinamento` — é o que permite ao
 * prompt apresentá-lo como ordem de execução e não como fonte de verdade.
 */
/*
 * Literal de TIPO é identificador, não texto — então neutro e fixo, como o
 * nome de uma ferramenta do agente. O reescritor de vocabulário o trocou por
 * interpolação numa primeira passada; tipo não pode ser dinâmico, e o
 * typecheck pegou na hora.
 */
export type ModoDoDocumento = 'prompt' | 'rag' | 'servico'

export interface DocumentoDeTreinamento {
    /**
     * A chave estável. **Nunca muda**, mesmo que o título na tela mude: é por
     * ela que o conteúdo é gravado e que os trechos indexados são substituídos.
     * Trocar um slug é perder o documento e o acervo dele.
     */
    slug: string
    /** O nome do campo na tela. */
    titulo: string
    /** O item do menu Treinamento onde ele mora. */
    item: string
    modo: ModoDoDocumento
    /**
     * Teto de caracteres. Nos `prompt` é limite de verdade — a soma deles é o
     * que vai em toda mensagem. Nos `rag` é só uma barreira de sanidade, no
     * mesmo valor do teto de extração de arquivo.
     */
    teto: number
    /**
     * A precedência quando dois documentos se contradizem — menor ganha.
     *
     * Existe porque eles **vão** se contradizer: "Técnicas de venda" pede
     * urgência, "Privacidade e segurança" proíbe prometer resultado, e o
     * processo comercial manda conduzir ao agendamento. Sem ordem declarada,
     * ganha quem estiver mais perto do fim do prompt — por acidente. Num produto
     * de saúde isso não é detalhe de engenharia.
     */
    precedencia: number
    /**
     * As seções que o **modelo** oferece, na ordem.
     *
     * São sugestão, não contrato: servem ao botão "Inserir modelo" e a mais
     * nada. A conferência de estrutura **não** compara com esta lista — as
     * seções reais são da empresa e do método dela, e exigir nome acusava
     * documento bom. Ver `conferirEstrutura`.
     */
    secoes: string[]
    /** O que a tela explica sobre este documento. */
    explicacao: string
}

/**
 * A seção reservada, tratada de outro jeito pelo indexador.
 *
 * O prompt apresenta o conhecimento recuperado como **fonte de verdade**. Uma
 * "sugestão de resposta" indexada junto disso vira texto que o modelo repete
 * literalmente — inclusive a sugestão **da pergunta errada**, quando a busca
 * trouxe o trecho vizinho. É a origem clássica do "o agente respondeu uma coisa
 * sem sentido".
 *
 * Aqui ela entra como exemplo de estilo e de limite, nunca no corpo de fatos.
 */
export const SECAO_EXEMPLOS = 'Exemplos de resposta'

/**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada —, e a publicação reprova com
 * `MarcaNaoRegistradaError`. A forma que já reprovou cinco publicações.
 */
let documentosCache: readonly DocumentoDeTreinamento[] | null = null
export function DOCUMENTOS(): readonly DocumentoDeTreinamento[] {
    if (documentosCache === null) documentosCache = [
    {
        slug: 'instrucoes-centrais',
        /**
         * O nome que a conta lê. **O slug não muda** — é por ele que o
         * conteúdo e o acervo estão gravados.
         */
        titulo: 'Instruções gerais',
        /**
         * Guia própria, abaixo de Perfil, por decisão do Andre em 2026-11-05.
         *
         * Morava dentro do Perfil (`item: 'Perfil'`), e era o único campo da
         * guia que é um documento: editor próprio, botão de modelo, selo de
         * indexação e teto de caracteres, no meio de seis campos de cadastro.
         * O Perfil ficou com quem o agente é para a equipe; o comportamento
         * dele passou a ter lugar próprio, ao lado dos outros sete documentos.
         *
         * 17 caracteres, dentro de `LIMITE_DO_ROTULO`.
         */
        item: 'Instruções gerais',
        modo: 'prompt',
        teto: 10_000,
        precedencia: 2,
        secoes: [
            'Identidade do agente',
            'Tom de voz',
            'Objetivo principal',
            'Limites técnicos',
            SECAO_EXEMPLOS,
        ],
        explicacao:
            'Quem o agente é e como ele se comporta. Vai no início de toda conversa, ' +
            'em toda mensagem — é o que nunca pode depender de a busca acertar.',
    },
    {
        slug: 'empresa',
        titulo: 'Informações sobre a empresa',
        item: 'Empresa',
        modo: 'prompt',
        teto: 10_000,
        precedencia: 5,
        secoes: [
            'Identificação da empresa',
            'Endereço',
            'Horário de funcionamento',
            'Posicionamento e diferenciais',
            'Sobre a empresa',
            'Limites',
            SECAO_EXEMPLOS,
        ],
        explicacao:
            'Os fatos sobre a empresa: endereço, horário, diferenciais. Vai em toda ' +
            'mensagem — a medição mostrou que a busca não o encontrava de forma ' +
            'confiável (“onde vocês ficam?” vinha raspando o piso). Escreva o ' +
            `essencial, não a história ${comArtigo(vocab(), 'organizacao', 'de')}.`,
    },
    {
        slug: 'servicos',
        titulo: 'Serviços e Produtos',
        item: 'Serviços',
        /**
         * **Foi `rag` até 2026-11-12, e a troca é decisão do Andre.**
         *
         * O que a condenou foi uma medição: numa conta real, um pedido de
         * orçamento com três produtos saiu com o preço de **um**. Os outros dois
         * estavam no documento, indexados, num trecho com os nove preços — e a
         * busca não o trouxe. As cinco vagas foram para páginas de site do
         * Cérebro, que falam dos mesmos produtos e não têm preço nenhum.
         *
         * Preço é a mesma classe de pergunta que já tirou `empresa` do acervo:
         * frequente, crítica, e o modelo preenche com plausibilidade quando não
         * sabe. Não pode depender de a busca acertar.
         *
         * O teto é maior que os 10.000 dos outros documentos de prompt porque
         * catálogo cresce com o cliente: o maior em uso na data da troca tinha
         * **14.712** caracteres, e 10.000 travaria a conta no `PUT`.
         */
        modo: 'prompt',
        teto: 20_000,
        precedencia: 6,
        secoes: ['Regra geral', 'Serviços', 'Diferenciais', SECAO_EXEMPLOS],
        explicacao:
            'O que a empresa oferece, com valores e condições. Vai em toda mensagem: ' +
            'preço e condição não podem depender de a busca acertar.',
    },
    {
        slug: 'processo-comercial',
        titulo: 'Processo e regras do comercial',
        item: 'Processo comercial',
        modo: 'prompt',
        teto: 10_000,
        precedencia: 3,
        secoes: [
            'Objetivo comercial',
            'Etapas do atendimento',
            'Qualificação',
            'Agendamento',
            'Follow-up',
            'Limites comerciais',
            SECAO_EXEMPLOS,
        ],
        explicacao:
            'A espinha da condução do atendimento. Vai em toda mensagem, porque ' +
            'vale a cada resposta. Escreva a regra, não o manual: o que vai em toda ' +
            'mensagem custa em toda mensagem.',
    },
    {
        slug: 'tecnicas-de-venda',
        titulo: 'Metodologia de venda',
        item: 'Técnicas de venda',
        modo: 'prompt',
        teto: 10_000,
        precedencia: 7,
        secoes: ['Princípios', 'Descoberta de necessidade', 'Objeções', SECAO_EXEMPLOS],
        explicacao:
            'Como conduzir e como responder a objeção. Vai em toda mensagem — a ' +
            'medição mostrou que a busca não o alcançava (“depois eu vejo isso” não ' +
            'recuperava nada), e objeção é o momento em que ele mais precisa valer. ' +
            'Sempre subordinado aos limites de Privacidade.',
    },
    {
        slug: 'faq',
        titulo: 'Sinônimos e FAQ',
        item: 'F.A.Q',
        /**
         * **Também saiu do acervo em 2026-11-12, junto de `servicos`.**
         *
         * Aqui a razão é mais forte do que a do catálogo: este documento é
         * **léxico**, e léxico não se recupera por similaridade. A busca
         * vetorial encontra o trecho que *fala do assunto* da pergunta; uma
         * tabela de sinônimos não fala de assunto nenhum — ela traduz a palavra
         * que o cliente usou para a palavra que o catálogo usa. Ela precisa
         * estar presente **antes** de a pergunta ser interpretada, não depois.
         *
         * O teto é 15.000, acima dos 8.843 do maior em uso na data da troca.
         */
        modo: 'prompt',
        teto: 15_000,
        precedencia: 8,
        secoes: ['Sinônimos e expressões comuns', 'Perguntas e respostas', SECAO_EXEMPLOS],
        explicacao:
            'Como as pessoas de fato perguntam, e o vocabulário que elas usam. Vai em ' +
            'toda mensagem: sinônimo serve para entender a pergunta, não para responder.',
    },
    {
        slug: 'privacidade',
        titulo: 'Informações e privacidade',
        item: 'Privacidade',
        modo: 'prompt',
        teto: 10_000,
        precedencia: 1,
        secoes: [
            'Limites clínicos',
            'Pós-venda',
            'Privacidade e proteção dos dados',
            'Conflitos',
            SECAO_EXEMPLOS,
        ],
        explicacao:
            'Privacidade dos dados, segurança e o que o agente não faz nem promete. ' +
            'Tem a maior precedência de todas: quando qualquer outro documento ' +
            'conflita com este, este ganha.',
    },
    {
        slug: 'cenarios',
        titulo: 'Cenários de atendimento',
        item: 'Cenários',
        modo: 'servico',
        teto: 50_000,
        /**
         * Precedência 4: depois dos limites, da identidade e do processo, antes
         * dos fatos e da técnica de venda.
         *
         * Um procedimento diz **o que fazer**, e tem de ceder ao que a clínica
         * não faz (Privacidade) e a quem o agente é (Centrais). Mas ganha de um
         * fato recuperado: quando o cenário manda passar para a equipe, achar um
         * preço no acervo não autoriza responder o preço e seguir.
         */
        precedencia: 4,
        secoes: ['Cenários', SECAO_EXEMPLOS],
        explicacao:
            'Situações com passo a passo: quando acontece X, faça 1, 2, 3. Um ' +
            'subtítulo por situação, com uma linha "Quando:" e uma lista "Passos:". ' +
            'Só o título e o gatilho vão no prompt de toda mensagem; os passos ' +
            'chegam quando a conversa entra na situação.',
    },
]
    return documentosCache
}

/**
 * O teto do rótulo no índice da Tela 03, em caracteres.
 *
 * O índice tem 176px na largura mínima, e a moldura de cada item come ~42
 * (ícone 14, gap 8, padding 20) — sobram ~134px de texto. A régua vem de um
 * caso medido e registrado no DESIGN.md: "Condições da conversa", 21
 * caracteres, pediu 143px num índice de 137 e **saía cortado**. Dá ~6,8px por
 * caractere a 13px, logo ~19 caracteres.
 *
 * Existe porque o botão do índice tem `truncate`: rótulo comprido não quebra
 * nem avisa — ele **desaparece com reticências**, e ninguém nota ao escrever o
 * catálogo. "Privacidade e segurança" tinha 23 e seria cortado; virou
 * "Privacidade", com o resto dito em `explicacao`, que é onde o DESIGN.md manda
 * explicar.
 */
export const LIMITE_DO_ROTULO = 19

export function acharDocumento(slug: string): DocumentoDeTreinamento | undefined {
    return DOCUMENTOS().find((d) => d.slug === slug)
}

/** Os que vão no prompt, já na ordem de precedência. */
export function documentosDoPrompt(): DocumentoDeTreinamento[] {
    return DOCUMENTOS().filter((d) => d.modo === 'prompt').sort(
        (a, b) => a.precedencia - b.precedencia
    )
}

/**
 * Os que são indexados para busca — **`rag` e `procedimento`**.
 *
 * `procedimento` entra porque ele é recuperado: o catálogo vai no prompt, mas é
 * o corpo vindo da busca que diz os passos. Filtrar só `rag` aqui deixaria o
 * documento de Cenários nunca ser indexado, e o catálogo prometeria um
 * procedimento que nunca chega.
 *
 * O que separa os dois é o **tipo do trecho**, não a indexação: ver
 * `tipoDoAcervo`.
 */
export function documentosDoAcervo(): DocumentoDeTreinamento[] {
    return DOCUMENTOS().filter((d) => d.modo === 'rag' || d.modo === 'servico')
}

/** Só os de `rag`: os que carregam **fato**, não procedimento. */
export function documentosDeFato(): DocumentoDeTreinamento[] {
    return DOCUMENTOS().filter((d) => d.modo === 'rag')
}

/**
 * Os de `procedimento`.
 *
 * Existe para a lista escrita de precedência do prompt: o corpo deles chega por
 * busca, mas a **posição** deles na hierarquia tem de ser dita ao modelo, senão
 * um passo a passo recuperado vira a instrução menos subordinada do conjunto.
 */
export function documentosDeProcedimento(): DocumentoDeTreinamento[] {
    return DOCUMENTOS().filter((d) => d.modo === 'servico')
}

/**
 * O que os documentos de comportamento ocupam, somados — e o que isso custa.
 *
 * **Isto informa, não impede.** Quem limita é o teto de cada documento, e ter os
 * dois bloqueando era redundância: dois limites rígidos para a mesma coisa, e
 * nenhum dos dois ensinando nada. O `TETO_ABSOLUTO_DO_PROMPT` de 120.000 saiu
 * junto com a faixa `excessivo`, porque era inalcançável.
 *
 * A consequência que a faixa comunica é real e tem duas metades de gravidade
 * diferente:
 *
 *   - **Custo.** Tudo isto viaja em toda mensagem, e a conta cai na margem: o
 *     crédito do cliente é por ação entregue, não por consumo. Esta metade tem
 *     conserto — o bloco estável abre o prompt e vira prefixo cacheável, então
 *     da segunda mensagem da conversa em diante ele é cobrado com desconto.
 *   - **Atenção.** O modelo atende pior ao meio de um contexto longo. Esta
 *     metade **não** tem conserto por engenharia: é limite do modelo, e o único
 *     remédio é o texto ser regra e não manual.
 *
 * Os cortes são calibrados contra **dado real**, não contra estimativa — foi
 * assim que o teto de 11.000 nasceu errado da primeira vez. Uma faixa que chama
 * de pesado o uso normal não informa, assusta.
 *
 * **Recalibrados quando o conjunto de prompt passou de três documentos para
 * cinco.** `Empresa` e `Metodologia de venda` migraram de acervo para prompt por
 * decisão da medição, e com isso o máximo possível subiu de 30.000 para 50.000
 * (cinco documentos de 10.000). Os cortes antigos — 15.000 e 25.000 — foram
 * desenhados contra o máximo de 30.000, e tinham duas consequências que
 * deixaram de fazer sentido: o conjunto real do cliente pequeno passou a somar
 * 17.952 e seria chamado de "pesado" por crescer do jeito que nós mandamos, e
 * `muito-pesado` passou a acender em pouco mais da metade do que é permitido.
 *
 * 25.000 e 40.000 mantêm a proporção contra o novo máximo (metade e quatro
 * quintos), deixam o conjunto real medido em "confortável" com folga, e põem
 * `muito-pesado` em ~11.400 tokens — que é a ordem de grandeza onde a análise
 * original já apontava perda de atenção no meio do contexto.
 */

/** Português corrido gira em torno de 3,5 caracteres por token. */
const CARACTERES_POR_TOKEN = 3.5

export type FaixaDoOrcamento = 'confortavel' | 'pesado' | 'muito-pesado'

export function orcamentoDoPrompt(porSlug: Record<string, string>): {
    usado: number
    tokens: number
    faixa: FaixaDoOrcamento
} {
    const usado = documentosDoPrompt().reduce((s, d) => s + (porSlug[d.slug]?.length ?? 0), 0)
    const tokens = Math.round(usado / CARACTERES_POR_TOKEN)

    const faixa: FaixaDoOrcamento =
        usado > 40_000 ? 'muito-pesado' : usado > 25_000 ? 'pesado' : 'confortavel'

    return { usado, tokens, faixa }
}


/**
 * O esqueleto que o botão "Inserir modelo" escreve no campo.
 *
 * Existe porque o método **depende de o Markdown ser estruturado**, e nada
 * garantiria isso só pedindo para colar um `.md`: campo em branco com uma frase
 * cinza atrás é um pedido de redação, e quem não sabe o que escrever salva um
 * muro de prosa — que é exatamente o que o corte por cabeçalho não aproveita.
 * Com o esqueleto, virar documento bom é preencher, não redigir.
 */
export function modeloDoDocumento(doc: DocumentoDeTreinamento): string {
    /**
     * O modelo escrito ganha do esqueleto.
     *
     * `modelos.ts` guarda o `.md` de cada documento quando ele existe; enquanto
     * não existe, saem só os cabeçalhos do catálogo. Assim o botão funciona nos
     * oito desde já, e cada modelo real entra sem tocar em tela nem em rota.
     */
    const escrito = modeloEscrito(doc.slug)
    if (escrito) return escrito

    return `# ${doc.titulo}\n\n${doc.secoes.map((secao) => `## ${secao}\n`).join('\n')}`
}

/**
 * **Comentário de HTML no modelo: as duas objeções originais foram consertadas.**
 *
 * A primeira versão trazia `<!-- como preencher -->` e foi recusada por duas
 * razões, as duas corretas na época: comentário contava como corpo na
 * conferência de estrutura, e o texto da nossa própria dica seria vetorizado e
 * apresentado ao modelo como fonte de verdade.
 *
 * Nenhuma das duas vale mais. `semComentarios` roda antes do corte (ver
 * `lib/rag/secoes.ts`), antes da montagem do prompt, e desde 2026-10-31 também
 * no caminho do catálogo de Cenários, que era o último furo. A conferência de
 * estrutura da tela já aplica a mesma limpeza. Então comentário **não** conta
 * como corpo e **não** chega ao modelo por caminho nenhum.
 *
 * O que sobra é a asserção em `scripts/test-treinamento.ts`, que ainda proíbe
 * `<!--` num modelo escrito citando o motivo antigo. Ela é o único obstáculo ao
 * desenho aprovado para o passo 7 — exemplo de forma dentro de comentário, por
 * seção — e sai junto do primeiro modelo embarcado, não antes.
 */

/**
 * O que, na estrutura do documento, vai atrapalhar o agente.
 *
 * **Não confere nome de seção, e isso foi uma correção.** A primeira versão
 * comparava os `##` escritos com a lista do catálogo e acusava "sem conteúdo
 * em: Follow-up". Ao encontrar documentos reais de cliente, ficou claro que a
 * premissa estava errada: as seções são da clínica e do método dela —
 * "Prótese overdenture", "Etapa 4 — solicitação de agendamento", "Qual a
 * diferença entre protocolo e overdenture?". Nenhuma lista fixa casa com isso,
 * nem com o próximo cliente. O verificador acusava sete documentos bons.
 *
 * O que vale em **qualquer** redação são duas coisas, e são as que ficam:
 *
 *   - **Documento sem `##` nenhum.** O corte cai no caractere, e o agente passa
 *     a recuperar pedaços que começam e terminam no meio de uma frase.
 *   - **Seção maior que um trecho.** Ela vai ser cortada por caractere do mesmo
 *     jeito, só que por dentro — e aí metade de uma tabela de preço vira um
 *     trecho sem o cabeçalho da coluna.
 *
 * O resto é o número de trechos, que a tela mostra: é a melhor pista de que o
 * documento está bem seccionado.
 */
export interface ConferenciaDeEstrutura {
    /** Quantos trechos o documento vai gerar — o número que a tela mostra. */
    trechos: number
    /** Nenhum `##`: o corte vai ser por caractere, não por assunto. */
    semSecoes: boolean
    /** Seções que não cabem num trecho e serão cortadas por dentro. */
    grandesDemais: string[]
}

/**
 * Recebe as seções já cortadas por `secionarMarkdown`, e não o texto cru, para
 * conferir **exatamente o que vai ser indexado** — se o corte não viu a seção, o
 * agente também não vai.
 *
 * Por isso não existe um "vazias" separado de "faltando": o secionamento
 * descarta cabeçalho sem corpo, então seção vazia chega aqui como ausente. Para
 * quem preenche, o conselho é o mesmo nos dois casos.
 */
export function conferirEstrutura(
    secoesEncontradas: { caminho: string[]; corpo: string }[]
): ConferenciaDeEstrutura {
    const comConteudo = secoesEncontradas.filter((s) => s.corpo.trim() !== '')

    /**
     * "Sem seções" é ter conteúdo e nenhum cabeçalho — o secionamento devolve
     * uma única seção de caminho vazio. Documento vazio não é problema de
     * estrutura: é documento vazio, e a tela já mostra isso no contador.
     */
    const semSecoes =
        comConteudo.length > 0 && comConteudo.every((s) => s.caminho.length === 0)

    const nome = (caminho: string[]) => caminho.at(-1) ?? '(sem título)'

    return {
        trechos: comConteudo.length,
        semSecoes,
        grandesDemais: comConteudo
            .filter((s) => s.corpo.length > TAMANHO_DE_TRECHO)
            .map((s) => nome(s.caminho)),
    }
}

/**
 * O teto de um trecho, repetido daqui para a tela não importar de `rag/secoes`.
 *
 * `secoes.ts` é o dono do número; este é o espelho usado só para avisar. Vale a
 * repetição porque o alternativo seria a tela depender do módulo de corte, e um
 * teste confere que os dois batem.
 */
export const TAMANHO_DE_TRECHO = 1500
