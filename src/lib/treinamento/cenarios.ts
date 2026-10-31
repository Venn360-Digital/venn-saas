import { secionarMarkdown } from '@/lib/rag/secoes'
import { ehSecaoDeExemplos } from './exemplos'

/**
 * Os cenários: o oitavo documento de treinamento, e o primeiro de modo
 * `procedimento`.
 *
 * Parte pura: lê a estrutura, valida e monta o catálogo. Quem indexa é o
 * processador da fila; quem monta o prompt é `prompt.ts`.
 *
 * ## O que um cenário é, e por que não cabe nos sete documentos
 *
 * É um procedimento: *quando* a conversa chega numa situação, *quais passos* o
 * agente segue. É o que a Intercom chama *Procedures*, a Decagon *AOPs* e o
 * Chatwoot *Scenarios* — e em 2026 virou artefato de primeira classe nos quatro
 * produtos de referência.
 *
 * Três razões para ser documento próprio, e não uma seção do Processo comercial:
 *
 *   1. **o Processo comercial vai no prompt inteiro, em toda mensagem.** Vinte
 *      cenários lá dentro inflam o bloco estável de uma clínica que usa dois
 *      deles por dia;
 *   2. **o modelo segue passo numerado curto melhor do que prosa**, e misturar
 *      os dois formatos no mesmo documento dilui os dois;
 *   3. **o cenário é recuperável.** A seção inteira (`Quando:` + `Passos:`) é
 *      curta, cabe num trecho, e é achada por busca quando a conversa chega
 *      nela — que é o oposto de ir sempre.
 *
 * ## O desenho: catálogo estável, corpo sob demanda
 *
 * No bloco **estável** do prompt vai só o catálogo: título e gatilho de cada
 * cenário, uma linha cada (~30 tokens). É divulgação progressiva, o padrão das
 * Agent Skills: o agente sabe que o procedimento existe sem carregá-lo.
 *
 * O **corpo** entra no bloco volátil, quando a busca o traz — apresentado como
 * *procedimento a seguir*, não como fato. A distinção importa: um fato recuperado
 * é fonte de verdade para responder; um procedimento é ordem de execução.
 */

/** O gatilho e os passos de uma situação. */
export interface Cenario {
    /** O título da seção, sem o `##`. */
    titulo: string
    /** A frase do `Quando:` — quando este cenário vale. */
    quando: string
    /** Os passos, na ordem, já sem a numeração. */
    passos: string[]
}

/** O que impede um cenário de valer, para a tela dizer antes de salvar. */
export interface ProblemaDeCenario {
    titulo: string
    motivo: 'sem-quando' | 'sem-passos'
}

const RE_QUANDO = /^\s*quando\s*:\s*(.+)$/i
const RE_PASSO = /^\s*(?:\d+[.)]\s*|[-*]\s+)(.+)$/

/**
 * Lê os cenários de um documento.
 *
 * Reusa `secionarMarkdown`, que é o mesmo corte que o indexador usa — então o
 * que a tela valida e o que vai para o acervo são a **mesma** divisão. Uma
 * segunda forma de achar seções aqui deixaria a tela aprovar um cenário que o
 * indexador corta em dois.
 *
 * Seção sem `Quando:` ou sem passo nenhum entra em `problemas`, não em
 * `cenarios`: cenário sem gatilho nunca é recuperado com proveito (o catálogo
 * mostraria um título sem quando), e cenário sem passos não diz o que fazer.
 */
export function lerCenarios(markdown: string): { cenarios: Cenario[]; problemas: ProblemaDeCenario[] } {
    const cenarios: Cenario[] = []
    const problemas: ProblemaDeCenario[] = []

    for (const secao of secionarMarkdown(markdown)) {
        /**
         * **O cenário é a seção mais interna, e o nível não é lido daqui.**
         *
         * `secionarMarkdown` devolve `caminho` — o caminho de cabeçalhos, do mais
         * externo ao mais interno — e não o nível. Isso é melhor para o caso real:
         * o cenário é identificado por **ter gatilho e passos**, não por estar num
         * `##`. Quem escreve pode aninhar ("## Agendamento › ### Remarcação") e o
         * cenário continua sendo a folha.
         *
         * Seção sem cabeçalho nenhum (`caminho` vazio) é o preâmbulo do documento
         * e é ignorada: texto solto no topo não é cenário, e acusá-lo de "sem
         * gatilho" seria acusar um problema que não existe.
         */
        const titulo = secao.caminho[secao.caminho.length - 1]
        if (!titulo) continue

        /**
         * **A seção reservada de exemplos não produz cenário, e isto conserta um
         * defeito medido.**
         *
         * O catálogo declara `Exemplos de resposta` como reservada nos oito
         * documentos: ela mostra o jeito de responder e nunca é fonte de verdade.
         * `lerCenarios` não sabia disso, e identificava cenário por **ter
         * gatilho e passos** — o que é certo para o corpo do documento e errado
         * aqui.
         *
         * O efeito, medido com um exemplo escrito no mesmo formato que o modelo
         * ensina:
         *
         *     ## Exemplos de resposta
         *     ### Como respondemos quando pedem desconto
         *     Quando: a pessoa pede desconto.
         *     Passos:
         *     1. Ofereça 20% de desconto à vista.
         *
         * Isso entrava no catálogo do prompt estável como cenário de verdade. Uma
         * **ilustração** de política virava **ordem a executar**, em toda conversa
         * que casasse com o gatilho. É a mesma classe do defeito que
         * `lib/treinamento/exemplos.ts` conserta no acervo, entrando pela porta
         * do prompt.
         *
         * Confere o **caminho inteiro**, não só a folha: o cenário falso é a
         * subseção, e quem é reservado é o cabeçalho acima dela.
         */
        if (secao.caminho.some(ehSecaoDeExemplos)) continue

        const linhas = secao.corpo.split('\n')
        const quando = linhas.map((l) => l.match(RE_QUANDO)?.[1]?.trim()).find((q): q is string => !!q)

        const passos = linhas
            .map((l) => l.match(RE_PASSO)?.[1]?.trim())
            .filter((p): p is string => !!p && p.length > 0)

        if (!quando) {
            problemas.push({ titulo, motivo: 'sem-quando' })
            continue
        }
        if (passos.length === 0) {
            problemas.push({ titulo, motivo: 'sem-passos' })
            continue
        }

        cenarios.push({ titulo, quando, passos })
    }

    return { cenarios, problemas }
}

/**
 * Quantos cenários o catálogo estável carrega.
 *
 * Cada linha custa ~30 tokens, e o catálogo vai em **toda** mensagem. Vinte é
 * ~600 tokens — aceitável no prefixo que entra em cache a 10%. Cem seria
 * 3.000 tokens de catálogo para um agente que usa três, e aí a divulgação
 * progressiva deixa de progredir.
 *
 * O corte é pelos primeiros do documento, que é a ordem que quem escreveu
 * escolheu — e é a ordem em que a tela os mostra, então o corte é previsível.
 */
export const MAX_NO_CATALOGO = 20

/**
 * O catálogo para o bloco estável: um título e um gatilho por linha.
 *
 * Devolve `null` quando não há cenário válido, para a seção não ser emitida
 * vazia. Seção com cabeçalho e nada embaixo gasta tokens dizendo que não há
 * nada — e o modelo lê isso como "não existem procedimentos", que é verdade e
 * não precisava de 15 tokens.
 */
export function catalogoDeCenarios(cenarios: Cenario[]): string | null {
    if (cenarios.length === 0) return null

    const linhas = cenarios
        .slice(0, MAX_NO_CATALOGO)
        .map((c) => `- **${c.titulo}** — quando ${primeiraMinuscula(c.quando)}`)
        .join('\n')

    return (
        '## Cenários disponíveis\n' +
        'Situações com procedimento próprio. Quando a conversa chegar numa delas, o ' +
        'procedimento completo aparece em "Procedimento para esta situação" — siga os ' +
        'passos na ordem.\n' +
        linhas
    )
}

/** "O paciente quer remarcar" → "o paciente quer remarcar", para caber depois de "quando". */
function primeiraMinuscula(texto: string): string {
    return texto.charAt(0).toLowerCase() + texto.slice(1)
}

/**
 * O corpo do cenário recuperado, no bloco volátil.
 *
 * Apresentado como **procedimento a seguir**, e não como fato. Um fato
 * recuperado é fonte de verdade para responder; um procedimento é ordem de
 * execução, e o modelo trata os dois de forma diferente quando a seção diz qual
 * é qual. Misturá-lo em "Base de conhecimento" faria o agente *citar* os passos
 * ao paciente em vez de executá-los — que é o defeito mais provável aqui.
 */
export function procedimentoParaOPrompt(trechos: { title: string; content: string }[]): string | null {
    if (trechos.length === 0) return null

    return (
        '## Procedimento para esta situação\n' +
        'Siga os passos abaixo nesta ordem. **Não os leia para o paciente** — execute-os.\n\n' +
        trechos.map((t) => t.content).join('\n\n')
    )
}
