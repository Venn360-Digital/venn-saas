/**
 * O texto de uma planilha `.xlsx`, sem biblioteca.
 *
 * ## Por que à mão
 *
 * O projeto não tinha leitor de planilha, e as duas opções do npm custavam o
 * que não vale a pena pagar: a edição comunitária do SheetJS publicada no npm
 * parou na 0.18.5 com dois avisos de segurança abertos (poluição de protótipo
 * e ReDoS) — e o arquivo que chega aqui é de quem escreve no WhatsApp, que é a
 * definição de entrada não confiável; o `exceljs` depende de streams do Node,
 * que o workerd não tem.
 *
 * Um `.xlsx` é um zip com XML dentro, e o que se quer dele é só o texto das
 * células. Isso cabe em cem linhas: ler o diretório do zip, inflar as três
 * entradas que importam com `DecompressionStream` (que o Worker e o Node têm) e
 * tirar o valor de cada célula com uma expressão regular. Não é um leitor de
 * planilha — não calcula fórmula, não lê estilo, não entende data formatada —;
 * é o suficiente para o agente saber o que está escrito na lista de preços que
 * a pessoa mandou.
 *
 * ## Limites, declarados
 *
 * - Fórmula entra pelo valor em cache (`<v>`), que é o que o Excel gravou na
 *   última vez que calculou. Planilha salva sem cache sai com a célula vazia.
 * - Data vem como número de série do Excel (45000 em vez de 2023-03-15): o
 *   formato mora em `styles.xml`, e aplicar formato é o que faria disto um
 *   leitor de verdade. O agente lê "45000" e o texto em volta costuma dizer o
 *   que é.
 * - Só o deflate (método 8) e o armazenado (método 0): é o que todo gerador de
 *   `.xlsx` usa. Outro método lança, e o chamador trata como formato ilegível.
 */

/** O arquivo não é um zip que este leitor entende. */
export class XlsxIlegivel extends Error {}

const TETO_DE_CELULAS = 20_000

interface EntradaDoZip {
    nome: string
    metodo: number
    tamanhoComprimido: number
    inicioDosDados: number
}

function u16(b: Uint8Array, i: number): number {
    return b[i] | (b[i + 1] << 8)
}
function u32(b: Uint8Array, i: number): number {
    return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
}

/**
 * As entradas do zip, pelo diretório central.
 *
 * O diretório fica no fim do arquivo e aponta para cada cabeçalho local; é o
 * jeito correto de ler um zip (o cabeçalho local pode trazer tamanhos zerados
 * quando o gerador escreveu em fluxo, e o Excel faz isso).
 */
function entradasDoZip(bytes: Uint8Array): EntradaDoZip[] {
    // End of central directory: assinatura 0x06054b50, procurada de trás para
    // frente (o comentário do zip pode vir depois dela).
    let eocd = -1
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
        if (u32(bytes, i) === 0x06054b50) {
            eocd = i
            break
        }
    }
    if (eocd < 0) throw new XlsxIlegivel('não é um arquivo zip')

    const total = u16(bytes, eocd + 10)
    let p = u32(bytes, eocd + 16)
    const entradas: EntradaDoZip[] = []

    for (let n = 0; n < total; n++) {
        if (u32(bytes, p) !== 0x02014b50) throw new XlsxIlegivel('diretório do zip corrompido')
        const metodo = u16(bytes, p + 10)
        const tamanhoComprimido = u32(bytes, p + 20)
        const tamanhoDoNome = u16(bytes, p + 28)
        const tamanhoDoExtra = u16(bytes, p + 30)
        const tamanhoDoComentario = u16(bytes, p + 32)
        const cabecalhoLocal = u32(bytes, p + 42)
        const nome = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + tamanhoDoNome))

        // O cabeçalho local tem nome e extra próprios, que podem diferir dos
        // do diretório; os dados vêm depois deles.
        if (u32(bytes, cabecalhoLocal) !== 0x04034b50) throw new XlsxIlegivel('cabeçalho local corrompido')
        const nomeLocal = u16(bytes, cabecalhoLocal + 26)
        const extraLocal = u16(bytes, cabecalhoLocal + 28)
        const inicioDosDados = cabecalhoLocal + 30 + nomeLocal + extraLocal

        entradas.push({ nome, metodo, tamanhoComprimido, inicioDosDados })
        p += 46 + tamanhoDoNome + tamanhoDoExtra + tamanhoDoComentario
    }

    return entradas
}

async function inflar(bytes: Uint8Array, entrada: EntradaDoZip): Promise<string> {
    const dados = bytes.subarray(entrada.inicioDosDados, entrada.inicioDosDados + entrada.tamanhoComprimido)
    if (entrada.metodo === 0) return new TextDecoder().decode(dados)
    if (entrada.metodo !== 8) throw new XlsxIlegivel(`método de compressão ${entrada.metodo} não suportado`)

    /**
     * Um `ReadableStream` com o pedaço, e não `new Blob([dados])`: o tipo
     * `BlobPart` existe no `lib.dom` e **não** no `@cloudflare/workers-types`,
     * e o typecheck do Worker reprovou o build de preview por causa dele
     * (20/11/2026). O stream é o denominador comum dos dois ambientes.
     */
    const fonte = new ReadableStream<Uint8Array>({
        start(controlador) {
            controlador.enqueue(dados)
            controlador.close()
        },
    })
    const fluxo = fonte.pipeThrough(new DecompressionStream('deflate-raw'))
    return new Response(fluxo).text()
}

/** Desfaz as cinco entidades do XML que aparecem em texto de célula. */
function desescapar(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
}

/** O texto de um nó `<si>` ou `<is>`: a soma dos `<t>` dentro dele. */
function textoRico(xml: string): string {
    return desescapar(Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g), (m) => m[1]).join(''))
}

/**
 * O texto da planilha: uma linha por linha, células separadas por tabulação,
 * uma seção por aba com o nome dela.
 */
export async function extrairTextoDeXlsx(bytes: Uint8Array): Promise<string> {
    const entradas = entradasDoZip(bytes)
    const porNome = new Map(entradas.map((e) => [e.nome, e]))

    const shared = porNome.get('xl/sharedStrings.xml')
    const textosCompartilhados = shared
        ? Array.from((await inflar(bytes, shared)).matchAll(/<si>([\s\S]*?)<\/si>/g), (m) => textoRico(m[1]))
        : []

    /**
     * Os nomes das abas vêm do `workbook.xml`, na ordem em que aparecem; as
     * planilhas em si são `xl/worksheets/sheetN.xml`. O vínculo exato passa por
     * `_rels`, e aqui a ordem basta: um `.xlsx` gerado por Excel, LibreOffice ou
     * Google Sheets numera as folhas na ordem das abas.
     */
    const workbook = porNome.get('xl/workbook.xml')
    const nomesDasAbas = workbook
        ? Array.from((await inflar(bytes, workbook)).matchAll(/<sheet\s[^>]*name="([^"]*)"/g), (m) => desescapar(m[1]))
        : []

    const folhas = entradas
        .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.nome))
        .sort((a, b) => Number(a.nome.match(/\d+/)?.[0]) - Number(b.nome.match(/\d+/)?.[0]))

    const secoes: string[] = []
    let celulas = 0

    for (const [indice, folha] of folhas.entries()) {
        const xml = await inflar(bytes, folha)
        const linhas: string[] = []

        for (const linha of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
            const valores: string[] = []
            for (const celula of linha[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
                const atributos = celula[1]
                const corpo = celula[2]
                const tipo = atributos.match(/\bt="([^"]*)"/)?.[1]

                let valor = ''
                if (tipo === 's') {
                    const i = Number(corpo.match(/<v>([^<]*)<\/v>/)?.[1])
                    valor = textosCompartilhados[i] ?? ''
                } else if (tipo === 'inlineStr') {
                    valor = textoRico(corpo)
                } else {
                    valor = desescapar(corpo.match(/<v>([^<]*)<\/v>/)?.[1] ?? '')
                    if (tipo === 'b') valor = valor === '1' ? 'VERDADEIRO' : 'FALSO'
                }
                valores.push(valor.trim())
                if (++celulas > TETO_DE_CELULAS) break
            }
            // Linha vazia não vira linha em branco: planilha costuma ter
            // milhares delas depois do fim do conteúdo.
            if (valores.some((v) => v)) linhas.push(valores.join('\t').replace(/\t+$/, ''))
            if (celulas > TETO_DE_CELULAS) break
        }

        if (linhas.length) {
            const nome = nomesDasAbas[indice] ?? `Planilha ${indice + 1}`
            secoes.push(`## ${nome}\n${linhas.join('\n')}`)
        }
        if (celulas > TETO_DE_CELULAS) break
    }

    return secoes.join('\n\n')
}
