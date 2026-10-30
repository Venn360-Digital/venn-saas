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

import { SECAO_EXEMPLOS } from './documentos'

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

const ALVO = normalizar(SECAO_EXEMPLOS)

/**
 * O cabeçalho abre a seção de exemplos?
 *
 * Compara por prefixo normalizado, de propósito: quem preenche escreve
 * "Exemplos de respostas", "Exemplos de resposta (WhatsApp)" ou "exemplos de
 * resposta", e as três são a mesma seção. Exigir o título exato do modelo faria a
 * reserva valer só para quem clicou em "Inserir modelo" e não mexeu.
 */
export function ehSecaoDeExemplos(titulo: string): boolean {
    return normalizar(titulo).startsWith(ALVO)
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
