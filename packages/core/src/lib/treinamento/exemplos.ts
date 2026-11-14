/**
 * A seção reservada "Exemplos de resposta", separada do que vai para o acervo.
 *
 * ## O defeito que isto conserta
 *
 * O catálogo declara `SECAO_EXEMPLOS` como seção reservada desde que nasceu, com
 * a razão escrita: o prompt apresenta o conhecimento recuperado como **fonte de
 * verdade**, e uma "sugestão de resposta" indexada junto disso vira texto que o
 * modelo repete literalmente — inclusive a sugestão **da pergunta errada**,
 * quando a busca trouxe o trecho vizinho. É a origem clássica do "o agente
 * respondeu uma coisa sem sentido".
 *
 * Só que nada no runtime fazia a separação. Nos dois documentos de acervo
 * (`servicos` e `faq`), a seção de exemplos era cortada, vetorizada e entregue ao
 * modelo como fato, exatamente como o comentário do catálogo descrevia que não
 * podia. "Reservada" era intenção, não comportamento.
 *
 * ## O que esta função faz, e o que ainda não faz
 *
 * Ela **tira os exemplos do que é indexado**. O texto não se perde: a fonte
 * inteira continua em `agent_training_docs.content`, que é de onde se recorta de
 * novo quando o corte melhora.
 *
 * O que falta é a outra metade — apresentar o exemplo ao modelo como *estilo*
 * ("assim respondemos"), num bloco próprio, separado dos fatos. Enquanto esse
 * bloco não existe, indexar com um tipo novo não resolveria nada: o retriever
 * não filtra por tipo, então o trecho voltaria a ser servido como fato pelo mesmo
 * caminho. Tirar primeiro e apresentar depois é o que não deixa o defeito de pé
 * esperando a metade bonita.
 *
 * ## Por linha, e não por reconstrução
 *
 * Trabalha sobre as linhas e devolve o resto **literal**, no mesmo arranjo de
 * `semComentarios`. A alternativa — seccionar, filtrar e remontar o Markdown —
 * exigiria reescrever cabeçalhos a partir da árvore, e qualquer diferença ali
 * mudaria silenciosamente o corte de todo o resto do documento.
 */

/** ``` ou ~~~, com até três espaços de recuo, como o CommonMark permite. */
const CERCA = /^ {0,3}(```|~~~)/
const CABECALHO = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/** Sem acento, sem caixa, sem pontuação de borda — para comparar título escrito à mão. */
function normalizar(titulo: string): string {
    return titulo
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .trim()
}

/**
 * Enumerador no começo do título — "8.", "3)", "02 -".
 *
 * A pontuação já saiu em `normalizar`, então o que chega aqui é "8 exemplo...".
 * Existe porque documento numerado é comum em material trazido de fora, e sem
 * isto "## 8. Exemplo de resposta" não seria reconhecido por causa do dígito.
 */
const ENUMERADOR = /^\d+\s*/

/** A primeira palavra, que é o que distingue a seção reservada. Cobre o plural. */
const ABRE_COM = 'exemplo'

/** "resposta" ou "respostas" como palavra inteira. */
const SOBRE_RESPOSTA = /\brespostas?\b/

/**
 * O cabeçalho abre a seção de exemplos?
 *
 * **Duas condições, e as duas são necessárias — medido contra título real.**
 * A versão anterior comparava por prefixo contra o título declarado
 * (`"exemplos de resposta"`), e isso reconhecia só quem escreveu exatamente
 * aquilo, com sufixo opcional. Nos dois conjuntos de cliente lidos em
 * 2026-10-31, **nenhum** dos títulos escritos casava:
 *
 *   - `Exemplo ou sugestão de resposta — convênio` (em `faq`)
 *   - `Exemplos ou sugestões de resposta` (em `servicos`)
 *
 * As duas são seções de acervo, as duas iriam vetorizadas para o Cérebro como
 * fonte de verdade — o defeito que este módulo existe para evitar, entrando
 * pela porta do título. "Prefixo" tolerava sufixo e nada mais: não o singular,
 * não "ou sugestão" no meio.
 *
 * Por que não só `exemplo`: "Exemplos de cursos oferecidos" e "Exemplos de
 * documentos aceitos" são **fato**, e retirá-los calaria o agente sobre o que a
 * conta escreveu. Exigir a palavra `resposta` separa as duas famílias sem
 * depender de lista de títulos conhecidos.
 *
 * **O que fica de fora, de propósito:** `Exemplo completo` e `Exemplo de
 * abertura` (vistos em conjunto real de cliente) não têm a palavra `resposta` e
 * não são reconhecidos. Hoje é inofensivo — os dois estão em documento de modo
 * `prompt`, que não passa por aqui — e o conserto certo é o modelo ensinar o
 * nome declarado, não esta função crescer uma lista de sinônimos que envelhece.
 */
export function ehSecaoDeExemplos(titulo: string): boolean {
    const limpo = normalizar(titulo).replace(ENUMERADOR, '')
    return limpo.startsWith(ABRE_COM) && SOBRE_RESPOSTA.test(limpo)
}

export interface TextoSemExemplos {
    /** O documento sem as seções de exemplo — é isto que vai ao acervo. */
    fatos: string
    /** Os títulos retirados, na ordem. Serve ao registro e à tela. */
    retiradas: string[]
}

/**
 * Tira as seções de exemplo, com tudo o que está aninhado dentro delas.
 *
 * Um `###` embaixo de `## Exemplos de resposta` é parte dos exemplos, então a
 * remoção vai até o próximo cabeçalho de nível **igual ou mais raso**. Sem isso,
 * um exemplo subdividido por canal ("### No WhatsApp") voltaria para o acervo
 * pela porta de trás.
 */
export function semExemplos(texto: string): TextoSemExemplos {
    const saida: string[] = []
    const retiradas: string[] = []
    let dentroDeCerca = false
    /** Nível do cabeçalho que abriu a seção retirada; nulo quando não há. */
    let nivelRetirado: number | null = null

    for (const linha of texto.split('\n')) {
        if (CERCA.test(linha)) {
            dentroDeCerca = !dentroDeCerca
            if (nivelRetirado === null) saida.push(linha)
            continue
        }

        const achado = dentroDeCerca ? null : linha.match(CABECALHO)

        if (achado) {
            const nivel = achado[1].length
            const titulo = achado[2].trim()

            // Fecha a retirada ao encontrar cabeçalho igual ou mais raso.
            if (nivelRetirado !== null && nivel <= nivelRetirado) nivelRetirado = null

            if (nivelRetirado === null && ehSecaoDeExemplos(titulo)) {
                nivelRetirado = nivel
                retiradas.push(titulo)
                continue
            }
        }

        if (nivelRetirado === null) saida.push(linha)
    }

    return { fatos: saida.join('\n').trim(), retiradas }
}
