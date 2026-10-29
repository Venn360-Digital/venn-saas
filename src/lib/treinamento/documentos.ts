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

export const DOCUMENTOS: readonly DocumentoDeTreinamento[] = [
    {
        slug: 'instrucoes-centrais',
        titulo: 'Instruções centrais',
        item: 'Perfil',
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
        titulo: 'Detalhamento da empresa',
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
            'Os fatos sobre a empresa. O agente consulta quando a conversa pede — ' +
            'então pode ser longo sem pesar em toda resposta.',
    },
    {
        slug: 'servicos',
        titulo: 'Serviços prestados',
        item: 'Serviços',
        modo: 'rag',
        teto: 50_000,
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
            'Como conduzir e como responder a objeção. Consultado quando a conversa ' +
            'chega nesse ponto — e sempre subordinado aos limites de Privacidade.',
    },
    {
        slug: 'faq',
        titulo: 'Sinônimos e FAQ',
        item: 'F.A.Q',
        modo: 'rag',
        teto: 50_000,
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
 * O que os documentos de comportamento ocupam, somados — e o que isso custa.
 *
 * **Isto informa, não impede.** Quem limita é o teto de cada documento, e ter os
 * dois bloqueando era redundância: dois limites rígidos para a mesma coisa, e
 * nenhum dos dois ensinando nada. O `TETO_ABSOLUTO_DO_PROMPT` de 120.000 saiu
 * junto com a faixa `excessivo` — com três documentos de prompt a 10.000 cada, o
 * máximo possível é 30.000, então aquele teto era inalcançável e as duas faixas
 * de cima eram código morto.
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
 * assim que o teto de 11.000 nasceu errado da primeira vez. O conjunto de um
 * cliente pequeno de verdade soma 11.790, e isso precisa ler "confortável": uma
 * faixa que chama de pesado o uso normal não informa, assusta. Daí 15.000 e
 * 25.000, contra um máximo possível de 30.000 (três documentos de 10.000).
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
        usado > 25_000 ? 'muito-pesado' : usado > 15_000 ? 'pesado' : 'confortavel'

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
