/**
 * O secionamento do Markdown — a parte pura do corte do Cérebro.
 *
 * Fica separado de `chunker.ts` porque aquele carrega `server-only`, que **lança
 * em Node**: a lógica não poderia ser exercitada por `npm run test:chunker` de
 * dentro dele. É o mesmo arranjo de `src/lib/availability.ts`, e pela mesma
 * razão — o que decide fica em função pura, a casca fica fina.
 */

/** Uma seção do documento: o caminho de cabeçalhos até ela, e o corpo dela. */
export interface SecaoMarkdown {
    /** Do mais externo ao mais interno. Vazio em texto sem cabeçalho. */
    caminho: string[]
    corpo: string
}

const CABECALHO = /^(#{1,6})\s+(.+?)\s*#*\s*$/
/** ``` ou ~~~, com até três espaços de recuo, como o CommonMark permite. */
const CERCA = /^ {0,3}(```|~~~)/

/**
 * Quebra o Markdown em seções pelos cabeçalhos.
 *
 * Cabeçalho **dentro de cerca de código não conta** — um `# comentário` num
 * exemplo abriria uma seção fantasma e levaria o resto do documento para dentro
 * dela. Documento de treinamento com exemplo de mensagem cai nisso, e o sintoma
 * é o acervo pendurado num cabeçalho que não existe.
 *
 * **Cabeçalho sem corpo é descartado**: ele só organiza, e o caminho dele segue
 * nos filhos.
 */
export function secionarMarkdown(texto: string): SecaoMarkdown[] {
    const secoes: SecaoMarkdown[] = []
    const pilha: { nivel: number; titulo: string }[] = []
    let corpo: string[] = []
    let dentroDeCerca = false

    const fechar = () => {
        const conteudo = corpo.join('\n').trim()
        corpo = []
        if (conteudo) secoes.push({ caminho: pilha.map((p) => p.titulo), corpo: conteudo })
    }

    for (const linha of texto.split('\n')) {
        if (CERCA.test(linha)) {
            dentroDeCerca = !dentroDeCerca
            corpo.push(linha)
            continue
        }

        const achado = dentroDeCerca ? null : linha.match(CABECALHO)
        if (!achado) {
            corpo.push(linha)
            continue
        }

        fechar()

        const nivel = achado[1].length
        // Sai da pilha tudo no mesmo nível ou mais fundo: um `##` novo encerra o
        // `##` anterior e todos os `###` dele.
        while (pilha.length > 0 && pilha[pilha.length - 1].nivel >= nivel) pilha.pop()
        pilha.push({ nivel, titulo: achado[2].trim() })
    }

    fechar()
    return secoes
}

/**
 * Tira os comentários de HTML, preservando cerca de código.
 *
 * `<!-- … -->` é nota de quem escreve, não conteúdo — e sem isto ela seria
 * vetorizada e apresentada ao modelo como **fonte de verdade**, que é como o
 * prompt apresenta o acervo. Uma anotação do tipo "confirmar preço com a
 * recepção" viraria resposta ao paciente.
 *
 * **Dentro de cerca de código o comentário fica.** Um documento de treinamento
 * que mostre um exemplo de HTML ou de script é conteúdo legítimo, e apagar o que
 * está dentro da cerca mutilaria o exemplo. Mesma regra do secionamento, e pelo
 * mesmo motivo.
 *
 * Atravessa linha: um comentário aberto numa linha e fechado três abaixo é
 * removido inteiro.
 */
export function semComentarios(texto: string): string {
    const saida: string[] = []
    let dentroDeCerca = false
    let dentroDeComentario = false

    for (const linha of texto.split('\n')) {
        // A cerca só conta fora de comentário: ``` dentro de um comentário
        // aberto não abre bloco de código.
        if (!dentroDeComentario && CERCA.test(linha)) {
            dentroDeCerca = !dentroDeCerca
            saida.push(linha)
            continue
        }

        if (dentroDeCerca) {
            saida.push(linha)
            continue
        }

        let resto = linha
        let limpo = ''

        for (;;) {
            if (dentroDeComentario) {
                const fim = resto.indexOf('-->')
                if (fim < 0) break
                dentroDeComentario = false
                resto = resto.slice(fim + 3)
                continue
            }

            const inicio = resto.indexOf('<!--')
            if (inicio < 0) {
                limpo += resto
                break
            }
            limpo += resto.slice(0, inicio)
            resto = resto.slice(inicio + 4)
            dentroDeComentario = true
        }

        saida.push(limpo)
    }

    return saida.join('\n')
}

/** O caminho colado no texto, que é o que faz o trecho valer sozinho. */
export function prefixar(caminho: string[], corpo: string): string {
    return caminho.length > 0 ? `${caminho.join(' › ')}\n\n${corpo}` : corpo
}

/**
 * O teto de um trecho, em caracteres.
 *
 * 1500 porque a seção já é topicamente coerente — o risco de um trecho grande é
 * o vetor virar média de vários assuntos, e o cabeçalho é a garantia de que não
 * é o caso. Para texto sem estrutura, é o tamanho do corte por caractere.
 */
export const TAMANHO_MAX = 1500

/** Só dentro de uma seção grande demais, onde continuar o assunto é o certo. */
export const SOBREPOSICAO = 200

/**
 * De um documento para a lista de trechos, já prefixados.
 *
 * O cortador entra por parâmetro — e não importado — para esta decisão caber
 * aqui, na parte pura: é ela que diz *quando* cortar e que garante que **todo
 * pedaço repete o caminho**. Sem a repetição, o 2º pedaço em diante de uma seção
 * grande perde o assunto, que é exatamente o defeito que o secionamento veio
 * consertar — e é um defeito silencioso, porque o trecho continua parecendo
 * válido. A casca (`chunker.ts`) só escolhe o cortador.
 */
export async function montarTrechos(
    texto: string,
    cortar: (corpo: string) => Promise<string[]>
): Promise<string[]> {
    const trechos: string[] = []

    for (const secao of secionarMarkdown(texto)) {
        const inteiro = prefixar(secao.caminho, secao.corpo)

        if (inteiro.length <= TAMANHO_MAX) {
            trechos.push(inteiro)
            continue
        }

        for (const pedaco of await cortar(secao.corpo)) {
            const limpo = pedaco.trim()
            if (limpo) trechos.push(prefixar(secao.caminho, limpo))
        }
    }

    return trechos
}
