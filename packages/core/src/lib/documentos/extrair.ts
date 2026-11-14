/**
 * Extrair o texto de um arquivo — o lugar único.
 *
 * Nasceu dentro de `api/agents/knowledge/extract`, para o upload do Cérebro, e
 * saiu de lá quando ganhou o **segundo** chamador: o arquivo que o cliente manda
 * no WhatsApp. São o mesmo problema — "o que este arquivo diz?" — e duas cópias
 * divergiriam no primeiro formato novo, com o upload lendo `.docx` e a conversa
 * não.
 *
 * ## O que decide o formato é a extensão, e isto é escolha
 *
 * Os bytes diriam com mais certeza (é o que `mimeDaImagem` faz para imagem), mas
 * aqui a extensão é a informação que **existe nos dois caminhos**: o upload tem
 * `File.name` e a conversa tem o nome que o WhatsApp mandou. Ler o cabeçalho de
 * `.docx` — que é um zip — para distingui-lo de outro zip seria precisão sem uso.
 */

/** O arquivo não é de um formato que sabemos ler. */
export class FormatoNaoSuportado extends Error {}

/**
 * Os formatos que lemos, e o que dizer de cada recusa.
 *
 * `.doc` antigo tem mensagem própria porque é o erro que mais aparece e tem
 * saída fácil — "salve como .docx" —, e um "formato não suportado" genérico
 * deixaria a pessoa sem saber o que fazer.
 */
export function ehFormatoLegivel(nomeDoArquivo: string): boolean {
    const nome = nomeDoArquivo.toLowerCase()
    return (
        nome.endsWith('.pdf') ||
        nome.endsWith('.docx') ||
        /\.(txt|md|markdown|csv|json)$/.test(nome)
    )
}

/**
 * Extrai o texto. Lança `FormatoNaoSuportado` no que não sabe ler.
 *
 * Imagem e planilha ficam de fora de propósito: extrair delas exige OCR e um
 * leitor de XLSX, que o projeto não tem — e **imagem tem caminho melhor**, que é
 * ir anexada ao modelo multimodal (ver `lib/ai/midia-no-prompt.ts`). Aceitar e
 * ignorar seria pior: o arquivo apareceria na lista e o agente nunca saberia o
 * que havia nele.
 */
export async function extrairTexto(bytes: Uint8Array, nomeDoArquivo: string): Promise<string> {
    const nome = nomeDoArquivo.toLowerCase()

    if (nome.endsWith('.pdf')) {
        const { PDFParse } = await import('pdf-parse')
        const parser = new PDFParse({ data: bytes })
        try {
            const result = await parser.getText()
            return result.text
        } finally {
            await parser.destroy()
        }
    }

    if (nome.endsWith('.docx')) {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
        return result.value
    }

    if (/\.(txt|md|markdown|csv|json)$/.test(nome)) {
        return Buffer.from(bytes).toString('utf8')
    }

    throw new FormatoNaoSuportado(
        nome.endsWith('.doc')
            ? 'Formato .doc antigo não é lido. Salve como .docx ou PDF.'
            : 'Formato não suportado. Envie PDF, DOCX, TXT, MD ou CSV.'
    )
}

/** Espaço em volta de quebra de linha é ruído de extração, não parágrafo. */
export function normalizarExtraido(texto: string): string {
    return texto.replace(/\s+\n/g, '\n').trim()
}

/**
 * O teto do texto que entra no **prompt**, e ele é muito menor que o do Cérebro.
 *
 * O upload do Cérebro corta em 200.000 porque aquele texto é cortado em trechos
 * e recuperado por busca — nada dele viaja inteiro. Aqui é o oposto: o texto vai
 * para `Message.transcript`, e `transcript` entra no histórico **inteiro**, em
 * toda resposta daquela conversa até sair da janela.
 *
 * Dez mil caracteres são ~2.500 tokens, a ordem de grandeza de todo o bloco de
 * comportamento de um agente bem escrito. Um PDF de cem páginas no histórico
 * empurraria o resto do prompt para fora da atenção do modelo — o mesmo efeito
 * que o catálogo gigante tem, e que o teto por documento existe para evitar.
 */
export const MAX_CHARS_NO_PROMPT = 10_000

/** O aviso colado no fim de um texto cortado. Sem ele o modelo lê metade como se fosse tudo. */
export const AVISO_DE_CORTE = '\n\n[... o arquivo continua. Este é só o começo dele.]'

/**
 * O texto pronto para virar `transcript`, cortado com aviso.
 *
 * Corta **com aviso** em vez de recusar: as primeiras páginas de uma lista de
 * orçamento já respondem quase tudo, e recusar deixaria o agente sem nada. Mas o
 * aviso não é enfeite — sem ele o modelo trata o pedaço como o documento
 * completo e afirma que algo "não está na lista" quando está, na página sete.
 */
export function textoParaOTranscript(bruto: string, teto = MAX_CHARS_NO_PROMPT): string {
    const texto = normalizarExtraido(bruto)
    if (texto.length <= teto) return texto
    return texto.slice(0, teto) + AVISO_DE_CORTE
}
