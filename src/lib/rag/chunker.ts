import 'server-only'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { montarTrechos, SOBREPOSICAO, TAMANHO_MAX } from './secoes'

/**
 * Corta uma fonte em trechos recuperáveis, respeitando a estrutura do Markdown.
 *
 * Antes era `RecursiveCharacterTextSplitter` a 1000/200 e nada mais: corte por
 * contagem de caracteres, cego ao conteúdo. Três defeitos vinham disso, e os
 * dois últimos importam mais do que parecem:
 *
 *   - **Cortava no meio de tabela e de lista.** Meia linha de uma tabela de
 *     preços, sem o cabeçalho da coluna, é um trecho que o modelo lê como fato
 *     e não tem como interpretar.
 *   - **O trecho chegava ao modelo sem saber do que fala.** "A partir de R$ 180
 *     por mês", recuperado sozinho, não diz de qual tratamento. O modelo
 *     respondia o preço de uma coisa como se fosse de outra — e o prompt
 *     apresenta o trecho como "fonte de verdade", então ele responde com
 *     convicção.
 *   - **A sobreposição de 200 caracteres sangrava um assunto no seguinte.**
 *     Entre dois parágrafos do mesmo tema, sobreposição ajuda; entre o fim de
 *     "Ortodontia" e o começo de "Implante", ela só contamina.
 *
 * O conserto é o mesmo para os três: **cortar onde o autor já cortou.** O
 * Markdown traz a divisão pronta nos cabeçalhos, e cada seção é um assunto. Daí
 * uma seção que cabe sai inteira, e **cada trecho leva o caminho dos cabeçalhos
 * colado no texto** — "Serviços › Ortodontia › Preço" —, para valer sozinho,
 * que é como ele vai ser recuperado. A sobreposição passa a existir só dentro de
 * uma seção grande demais, onde ela de fato serve.
 *
 * Texto sem nenhum cabeçalho — PDF extraído, página de site — cai no caminho
 * antigo, sem prefixo: é uma seção única, cortada por caractere. Nada regride
 * para quem não escreve em Markdown.
 *
 * **Fundir seções curtas foi considerado e recusado.** Um FAQ com cinquenta
 * `###` curtinhos gera cinquenta trechos pequenos, e isso é o desejável: uma
 * pergunta com a sua resposta é a unidade de recuperação perfeita. Fundir
 * juntaria duas perguntas sem relação num vetor só, que é exatamente o que se
 * quer evitar.
 *
 * **Isto se acopla ao teto de trechos da busca** (`AI_RAG_CHUNKS`): trecho menor
 * e mais preciso pede mais trechos por resposta. Mexer num sem olhar o outro
 * entrega menos contexto do que antes.
 *
 * **O acervo já indexado não muda sozinho.** Os trechos gravados continuam como
 * foram cortados; o modelo de embedding é o mesmo, então eles seguem
 * comparáveis e a busca não quebra. Para uma fonte passar a ser cortada assim,
 * ela precisa ser reindexada (`replaceExisting`).
 */
export class DocumentChunker {
    private splitter: RecursiveCharacterTextSplitter

    constructor(chunkSize = TAMANHO_MAX, chunkOverlap = SOBREPOSICAO) {
        this.splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
            chunkSize,
            chunkOverlap,
        })
    }

    async split(text: string): Promise<string[]> {
        // Quando e como prefixar é decisão de `montarTrechos`, que é pura e
        // testada. Daqui sai só o corte de uma seção grande demais.
        return montarTrechos(text, async (corpo) => {
            const pedacos = await this.splitter.createDocuments([corpo])
            return pedacos.map((p) => p.pageContent)
        })
    }
}
