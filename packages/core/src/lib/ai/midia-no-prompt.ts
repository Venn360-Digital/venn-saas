/**
 * O que o modelo recebe quando a mensagem é um arquivo, e não texto.
 *
 * Parte pura: decide, não busca. Quem lê bytes do storage é o `ai-reply`.
 *
 * ## O defeito que isto conserta
 *
 * O decodificador do WhatsApp **inventa um texto** quando a mensagem não traz
 * palavra de quem escreveu — `📷 Imagem`, `📄 orcamento.pdf` (ver
 * `lib/whatsapp/payload.ts`). Isso existe para a tela ter o que mostrar, e está
 * certo. O que estava errado é que esse marcador seguia **para o modelo** como
 * se fosse a fala da pessoa: o histórico tinha caso especial só para áudio.
 *
 * Medido em produção: uma conta recebeu `IOSNEI-.pdf` com uma lista de
 * orçamento, e o agente "leu" a string `📄 IOSNEI-.pdf`. Ele não falhou de
 * forma visível — respondeu pedindo informações que estavam no arquivo.
 *
 * ## As duas respostas, e por que são diferentes
 *
 * - **imagem** o modelo lê de verdade: `gpt-4o` e os `gpt-6.x` são multimodais,
 *   então a foto vai anexada e ele a enxerga;
 * - **documento** ele ainda não lê. E aqui a resposta certa não é silêncio: é
 *   dizer ao modelo que chegou um arquivo que ele **não** pode abrir. Sem isso
 *   ele trata o nome do arquivo como conteúdo e inventa o que havia dentro, que
 *   é o pior dos três resultados possíveis.
 */

import { ehMarcadorDeMidia } from '../whatsapp/payload'

/** A forma mínima que estas decisões leem. */
export interface MensagemComMidia {
    direction: string
    content: string
    contentType?: string | null
    transcript?: string | null
    mediaUrl?: string | null
    isInternal?: boolean | null
}

/**
 * Quantas imagens de uma conversa vão para uma resposta.
 *
 * Duas, e o teto não é arbitrário: cada imagem custa tokens de entrada na faixa
 * de centenas a poucos milhares, e isso é cobrado do crédito da conta como
 * qualquer resposta. Duas cobre o caso real — a pessoa manda a foto da lista e
 * logo outra do verso — e mantém a conta previsível.
 *
 * O corte é pelas **mais recentes**, nunca pelas primeiras: a foto que importa é
 * a que acabou de chegar.
 */
export const MAX_IMAGENS_POR_RESPOSTA = 2

/**
 * Quão atrás vale procurar imagem.
 *
 * Foto de dez mensagens atrás quase nunca é o assunto de agora, e anexá-la
 * gastaria token para reintroduzir um assunto encerrado. Seis cobre o vai e vem
 * curto em volta de um arquivo ("é essa?", "sim, essa").
 */
export const JANELA_DE_MIDIA = 6

/** A mensagem traz imagem que dá para anexar? */
export function ehImagemAnexavel(m: MensagemComMidia): boolean {
    return (
        m.direction === 'inbound' &&
        !m.isInternal &&
        m.contentType === 'image' &&
        typeof m.mediaUrl === 'string' &&
        m.mediaUrl.length > 0
    )
}

/**
 * Os índices do histórico cujas imagens devem ser lidas, em ordem cronológica.
 *
 * Devolve índice e não a mensagem porque quem chama precisa casar o byte lido
 * com a posição exata do histórico — e duas mensagens podem ter o mesmo
 * `mediaUrl` quando a pessoa reencaminha o mesmo arquivo.
 */
export function imagensParaAnexar(
    historico: MensagemComMidia[],
    max = MAX_IMAGENS_POR_RESPOSTA,
    janela = JANELA_DE_MIDIA
): number[] {
    if (max <= 0) return []

    const inicio = Math.max(0, historico.length - janela)
    const candidatos: number[] = []

    // De trás para frente: o teto tem de ficar com as mais novas.
    for (let i = historico.length - 1; i >= inicio; i--) {
        if (ehImagemAnexavel(historico[i])) candidatos.push(i)
        if (candidatos.length === max) break
    }

    return candidatos.reverse()
}

/**
 * O aviso que substitui o marcador de um arquivo que o modelo não abre.
 *
 * Escrito como fato do sistema, não como instrução da empresa: ele diz o que
 * aconteceu e o que **não** dá para fazer. O que fazer em seguida é decisão do
 * treinamento da conta — passar para a equipe, pedir por escrito —, e não cabe
 * a esta linha escolher.
 */
export function avisoDeArquivoNaoLido(nomeDoArquivo: string): string {
    const nome = nomeDoArquivo.trim()
    return (
        `[A pessoa enviou um arquivo${nome ? `: ${nome}` : ''}. ` +
        `Você não consegue abrir nem ler arquivos — não suponha o conteúdo dele.]`
    )
}

/** O nome do arquivo, tirado do marcador que o decodificador montou. */
export function nomeDoArquivo(content: string): string {
    return content.replace(/^📄\s*/, '').trim()
}

/**
 * O texto desta mensagem para o modelo.
 *
 * A ordem dos casos é a ordem da certeza: transcrição é texto de verdade, e
 * ganha de qualquer marcador; documento sem transcrição vira o aviso; mídia com
 * legenda vale pela legenda; e marcador sem mais nada fica como está.
 *
 * `transcript` serve a **qualquer** mídia, não só a áudio: é a coluna onde o
 * texto extraído mora. Quando a extração de PDF existir, ela grava ali e este
 * ramo passa a cobri-la sem mudança nenhuma aqui.
 */
export function textoParaOModelo(m: MensagemComMidia): string {
    const transcrito = m.transcript?.trim()
    if (transcrito) {
        return m.contentType === 'audio' ? `[Nota de voz] ${transcrito}` : transcrito
    }

    const texto = m.content?.trim() ?? ''

    // Legenda de foto é fala da pessoa: vale mais que qualquer aviso nosso.
    if (!ehMarcadorDeMidia(texto)) return texto

    if (m.contentType === 'file') return avisoDeArquivoNaoLido(nomeDoArquivo(texto))

    /**
     * Imagem anexada **mantém o marcador**, e isso é deliberado: o modelo vai
     * receber a imagem de verdade ao lado, então o texto só precisa não mentir.
     * Trocá-lo pelo aviso de "não consigo ler" seria contradizer o anexo.
     */
    return texto
}

/**
 * O tipo da imagem, pelos **primeiros bytes** dela.
 *
 * A chave do storage não tem extensão (`<workspace>/<conversa>/<id>`), e o banco
 * não guarda o mimetype da mídia recebida — então o nome do arquivo não pode
 * decidir isto. Assinatura de arquivo decide, e é o único jeito que não depende
 * de dado que não temos.
 *
 * `null` para o que não reconhece: mandar `data:image/jpeg` com bytes de outra
 * coisa faz a API recusar a mensagem inteira, e aí a pessoa fica sem resposta
 * por causa de um palpite nosso. Sem tipo, a imagem simplesmente não vai, e o
 * modelo segue com o texto.
 */
export function mimeDaImagem(bytes: Uint8Array): string | null {
    if (bytes.length < 12) return null

    const b = bytes
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'

    // WEBP: "RIFF" .... "WEBP"
    const riff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    const webp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    if (riff && webp) return 'image/webp'

    return null
}

/**
 * O teto de bytes de uma imagem anexada.
 *
 * O WhatsApp já limita o que entra, e isto não é um segundo limite de produto —
 * é a guarda do **nosso** lado: `data:` cresce em 1/3 na conversão para base64,
 * e a mensagem inteira ainda tem de caber no corpo de uma requisição. Ver a
 * decisão de 2026-10-23 de não haver teto de mídia no produto.
 */
export const MAX_BYTES_DA_IMAGEM = 5 * 1024 * 1024

/** A imagem cabe e é de um tipo que o modelo lê? */
export function imagemServeParaOModelo(bytes: Uint8Array): string | null {
    if (bytes.length > MAX_BYTES_DA_IMAGEM) return null
    return mimeDaImagem(bytes)
}
