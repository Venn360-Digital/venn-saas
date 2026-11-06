/**
 * A marcação do WhatsApp, lida como o WhatsApp a lê.
 *
 * Quem atende escreve `*urgente*` porque é o que ele digita no celular o dia
 * inteiro, e o paciente manda `*não* posso terça` pelo mesmo motivo. Até aqui a
 * bolha mostrava os asteriscos crus nos dois sentidos: o destaque que a pessoa
 * pôs não aparecia, e o que ela recebeu aparecia sujo.
 *
 * **Isto é um analisador, não um renderizador.** Devolve uma árvore de nós e
 * não HTML, por duas razões. A primeira é segurança: texto de paciente nunca
 * vira `dangerouslySetInnerHTML`, e sem string de HTML no caminho não há como
 * alguém escrever `<img onerror>` numa mensagem e isso ser injeção. A segunda é
 * que a mesma árvore serve a dois consumidores com necessidades opostas — a
 * bolha, que quer o negrito, e a prévia do cartão da lista, que quer o texto
 * limpo numa linha só (`semMarcacao`).
 *
 * ## As regras são as do WhatsApp, e elas são restritivas de propósito
 *
 * Um asterisco solto no meio de uma frase **não** é marcação, e é por isso que
 * "2 * 3" e "o_nome_do_arquivo" continuam intactos. Para abrir um trecho, o
 * delimitador precisa de três coisas ao mesmo tempo: não estar colado a letra
 * ou dígito à esquerda, não ter espaço à direita, e encontrar o par antes do
 * fim do parágrafo. Fechar exige o espelho disso. Regra mais frouxa que esta
 * transforma prosa normal em itálico aleatório, que é pior do que não formatar.
 */

export type NoDeTexto =
    | { tipo: 'texto'; texto: string }
    | { tipo: 'negrito'; filhos: NoDeTexto[] }
    | { tipo: 'italico'; filhos: NoDeTexto[] }
    | { tipo: 'tachado'; filhos: NoDeTexto[] }
    | { tipo: 'mono'; texto: string }
    | { tipo: 'blocoMono'; texto: string }
    | { tipo: 'citacao'; filhos: NoDeTexto[] }

/** Os quatro delimitadores de trecho, e o nó que cada um produz. */
const MARCAS = {
    '*': 'negrito',
    _: 'italico',
    '~': 'tachado',
    '`': 'mono',
} as const

type Marca = keyof typeof MARCAS

function ehPalavra(caractere: string | undefined): boolean {
    return caractere !== undefined && /[\p{L}\p{N}]/u.test(caractere)
}

/**
 * Pode abrir marcação aqui?
 *
 * O caractere anterior não pode ser letra nem dígito — é o que protege
 * `arquivo_final_v2` e `a*b`. E o seguinte não pode ser espaço, porque
 * `* item` é lista, não negrito vazio.
 */
function podeAbrir(texto: string, i: number): boolean {
    if (ehPalavra(texto[i - 1])) return false
    const seguinte = texto[i + 1]
    return seguinte !== undefined && !/\s/.test(seguinte)
}

/** Procura o par de `marca` depois de `inicio`, com as regras de fechamento. */
function acharFechamento(texto: string, marca: Marca, inicio: number): number {
    for (let i = inicio; i < texto.length; i++) {
        if (texto[i] !== marca) continue
        // Espaço antes do fechamento não fecha: em "a * b * c" os asteriscos
        // são sinais de multiplicação, não marcação.
        if (/\s/.test(texto[i - 1] ?? '')) continue
        // Nem letra/dígito depois, pelo mesmo motivo do `podeAbrir`.
        if (ehPalavra(texto[i + 1])) continue
        return i
    }
    return -1
}

/**
 * O trecho entre delimitadores, já em árvore.
 *
 * Recursivo porque as marcas se combinam — `*_assim_*` é negrito e itálico ao
 * mesmo tempo, e é assim que o WhatsApp mostra. A exceção é a monoespaçada:
 * dentro dela nada é marcação, que é o ponto de existir uma.
 */
function analisarTrecho(texto: string): NoDeTexto[] {
    const nos: NoDeTexto[] = []
    let acumulado = ''

    const despejar = () => {
        if (acumulado) {
            nos.push({ tipo: 'texto', texto: acumulado })
            acumulado = ''
        }
    }

    for (let i = 0; i < texto.length; i++) {
        const c = texto[i]
        const marca = c in MARCAS ? (c as Marca) : null

        if (!marca || !podeAbrir(texto, i)) {
            acumulado += c
            continue
        }

        const fim = acharFechamento(texto, marca, i + 1)
        if (fim === -1) {
            acumulado += c
            continue
        }

        const dentro = texto.slice(i + 1, fim)
        // `**` não é negrito vazio, é dois asteriscos. `acharFechamento` acha
        // o par imediato porque nenhuma das guardas dele fala de conteúdo.
        if (!dentro) {
            acumulado += c
            continue
        }
        despejar()

        if (marca === '`') {
            nos.push({ tipo: 'mono', texto: dentro })
        } else {
            nos.push({ tipo: MARCAS[marca], filhos: analisarTrecho(dentro) })
        }

        i = fim
    }

    despejar()
    return nos
}

/**
 * O texto de uma mensagem, em árvore.
 *
 * A ordem importa: o bloco ``` é tirado **primeiro**, porque dentro dele nada
 * é marcação (é para isso que ele serve), e a citação `>` é resolvida por
 * linha, porque é o único traço que o WhatsApp ancora no começo da linha.
 */
export function analisarTextoDeWhatsApp(texto: string): NoDeTexto[] {
    if (!texto) return []

    const nos: NoDeTexto[] = []
    const partes = texto.split('```')

    partes.forEach((parte, indice) => {
        // Índice ímpar = estava entre um par de ```. Um ``` sem par deixa o
        // resto como texto comum, que é o que o WhatsApp também faz.
        const dentroDeBloco = indice % 2 === 1 && indice < partes.length - 1
        if (dentroDeBloco) {
            nos.push({ tipo: 'blocoMono', texto: parte })
            return
        }
        if (indice % 2 === 1) {
            nos.push({ tipo: 'texto', texto: '```' })
        }
        nos.push(...analisarComCitacao(parte))
    })

    return nos
}

/** As linhas que começam com `> ` viram citação; as outras seguem normais. */
function analisarComCitacao(texto: string): NoDeTexto[] {
    if (!/^>\s/m.test(texto)) return analisarTrecho(texto)

    const nos: NoDeTexto[] = []
    const linhas = texto.split('\n')
    let buffer: string[] = []
    let citando = false

    const despejar = () => {
        if (!buffer.length) return
        const junto = buffer.join('\n')
        if (citando) nos.push({ tipo: 'citacao', filhos: analisarTrecho(junto) })
        else nos.push(...analisarTrecho(junto))
        buffer = []
    }

    for (const linha of linhas) {
        const ehCitacao = /^>\s/.test(linha)
        if (ehCitacao !== citando) {
            despejar()
            citando = ehCitacao
        }
        buffer.push(ehCitacao ? linha.replace(/^>\s/, '') : linha)
    }
    despejar()

    return nos
}

/**
 * O mesmo texto sem os delimitadores, numa linha só.
 *
 * Para a prévia do cartão da lista e para a citação de resposta, que são
 * truncadas: ali renderizar negrito não ajuda a reconhecer a conversa, e
 * mostrar os asteriscos é justamente o defeito que se está consertando. Sai
 * pelo analisador e não por um `replace` de asteriscos porque só o analisador
 * sabe quais asteriscos eram marcação.
 */
export function semMarcacao(texto: string): string {
    return achatar(analisarTextoDeWhatsApp(texto)).replace(/\s+/g, ' ').trim()
}

function achatar(nos: NoDeTexto[]): string {
    return nos
        .map((no) => {
            switch (no.tipo) {
                case 'texto':
                case 'mono':
                case 'blocoMono':
                    return no.texto
                default:
                    return achatar(no.filhos)
            }
        })
        .join('')
}

/** Tem alguma marcação de fato? Serve para não remontar o que não muda. */
export function temMarcacao(texto: string): boolean {
    return analisarTextoDeWhatsApp(texto).some((no) => no.tipo !== 'texto')
}
