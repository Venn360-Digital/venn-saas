/**
 * O catálogo dos documentos de treinamento do agente — a espinha do método.
 *
 * O treinamento deixa de ser uma dúzia de campos avulsos e passa a ser **sete
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
 * Mandar os sete documentos no prompt a cada mensagem seria trocar ~2 mil tokens
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

export type ModoDoDocumento = 'prompt' | 'rag'

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
    /** As seções que o modelo oferece, na ordem. */
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

export const DOCUMENTOS: readonly DocumentoDeTreinamento[] = [
    {
        slug: 'instrucoes-centrais',
        titulo: 'Instruções centrais',
        item: 'Perfil',
        modo: 'prompt',
        teto: 4000,
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
        titulo: 'Detalhamento da empresa',
        item: 'Empresa',
        modo: 'rag',
        teto: 200_000,
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
            'Os fatos sobre a empresa. O agente consulta quando a conversa pede — ' +
            'então pode ser longo sem pesar em toda resposta.',
    },
    {
        slug: 'servicos',
        titulo: 'Serviços prestados',
        item: 'Serviços',
        modo: 'rag',
        teto: 200_000,
        precedencia: 6,
        secoes: ['Regra geral', 'Serviços', 'Diferenciais', SECAO_EXEMPLOS],
        explicacao:
            'O que a empresa oferece, com valores e condições. É o documento mais ' +
            'consultado: use um subtítulo por serviço, que é o que vira um trecho.',
    },
    {
        slug: 'processo-comercial',
        titulo: 'Processo comercial e políticas',
        item: 'Processo comercial',
        modo: 'prompt',
        teto: 4000,
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
            'vale a cada resposta — por isso tem teto: escreva a regra, não o manual.',
    },
    {
        slug: 'tecnicas-de-venda',
        titulo: 'Metodologia de venda',
        item: 'Técnicas de venda',
        modo: 'rag',
        teto: 200_000,
        precedencia: 7,
        secoes: ['Princípios', 'Descoberta de necessidade', 'Objeções', SECAO_EXEMPLOS],
        explicacao:
            'Como conduzir e como responder a objeção. Consultado quando a conversa ' +
            'chega nesse ponto — e sempre subordinado aos limites de Privacidade.',
    },
    {
        slug: 'faq',
        titulo: 'Sinônimos e FAQ',
        item: 'F.A.Q',
        modo: 'rag',
        teto: 200_000,
        precedencia: 8,
        secoes: ['Sinônimos e expressões comuns', 'Perguntas e respostas', SECAO_EXEMPLOS],
        explicacao:
            'Como as pessoas de fato perguntam. Um subtítulo por pergunta: pergunta ' +
            'com a sua resposta é a unidade que a busca recupera melhor.',
    },
    {
        slug: 'privacidade',
        titulo: 'Informações e privacidade',
        item: 'Privacidade',
        modo: 'prompt',
        teto: 3000,
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
]

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
    return DOCUMENTOS.find((d) => d.slug === slug)
}

/** Os que vão no prompt, já na ordem de precedência. */
export function documentosDoPrompt(): DocumentoDeTreinamento[] {
    return DOCUMENTOS.filter((d) => d.modo === 'prompt').sort(
        (a, b) => a.precedencia - b.precedencia
    )
}

/** Os que são indexados para busca. */
export function documentosDoAcervo(): DocumentoDeTreinamento[] {
    return DOCUMENTOS.filter((d) => d.modo === 'rag')
}

/**
 * Quanto de prompt os documentos "sempre no prompt" podem ocupar, somados.
 *
 * É o número que mantém o método viável: é teto, e serve para a tela poder
 * dizer quanto resta antes de alguém descobrir pela resposta.
 */
export const TETO_SOMADO_DO_PROMPT = documentosDoPrompt().reduce((s, d) => s + d.teto, 0)

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
     * sete desde já, e cada modelo real entra sem tocar em tela nem em rota.
     */
    const escrito = modeloEscrito(doc.slug)
    if (escrito) return escrito

    return `# ${doc.titulo}\n\n${doc.secoes.map((secao) => `## ${secao}\n`).join('\n')}`
}

/**
 * **Sem comentário de HTML no modelo**, e isso foi deliberado.
 *
 * A primeira versão trazia `<!-- como preencher -->` sob a seção de exemplos. O
 * teste mostrou o defeito: comentário é corpo. A seção passava por preenchida na
 * conferência de estrutura, e — pior — o texto da nossa própria dica seria
 * vetorizado e apresentado ao modelo como fonte de verdade. A orientação mora em
 * `explicacao`, que é texto de tela e nunca é indexado.
 *
 * Fica a lacuna conhecida: o admin ainda pode escrever um comentário dele, e
 * esse vai para o acervo. Limpar `<!-- … -->` antes de indexar — respeitando
 * cerca de código — é conserto para quando a indexação dos documentos existir, e
 * não antes: função sem chamador é código morto.
 */

/**
 * O que falta e o que sobra na estrutura de um documento.
 *
 * Não reprova nada — avisa. O admin pode ter um motivo para não ter "Follow-up",
 * e travar o salvar por causa de um cabeçalho seria pior que o problema. O que
 * não pode é ele **achar** que preencheu.
 */
export interface ConferenciaDeEstrutura {
    /** Seções do modelo que não aparecem no texto, ou aparecem sem conteúdo. */
    faltando: string[]
    /** Cabeçalhos de 2º nível que o texto tem e o modelo não previa. */
    extras: string[]
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
    doc: DocumentoDeTreinamento,
    secoesEncontradas: { caminho: string[]; corpo: string }[]
): ConferenciaDeEstrutura {
    /** O 2º nível é o que o modelo propõe; o 1º é o título do documento. */
    const nivel2 = (caminho: string[]) => caminho[1] ?? caminho[0]

    const presentes = new Set<string>()
    for (const s of secoesEncontradas) {
        const nome = nivel2(s.caminho)
        if (nome && s.corpo.trim() !== '') presentes.add(nome)
    }

    const previstas = new Set(doc.secoes)

    return {
        faltando: doc.secoes.filter((s) => !presentes.has(s)),
        extras: [...presentes].filter((s) => !previstas.has(s)),
    }
}
