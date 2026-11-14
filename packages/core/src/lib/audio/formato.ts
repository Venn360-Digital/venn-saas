/**
 * O formato de um áudio lido dos **bytes**, não do que o provedor diz.
 *
 * ## Por que não confiar no mimetype
 *
 * A transcrição precisa dizer à OpenAI o formato do arquivo, e até aqui dizia
 * por palpite: `transcribe.ts` olhava o mimetype declarado e, quando não
 * reconhecia nada, chamava o arquivo de `nota.ogg`. Dois caminhos levavam ao
 * palpite errado:
 *
 * - o Evolution Go **não informa o tipo** em `/message/downloadmedia`, e desde
 *   que o base64 passou a sair do job (23/10, limite de 128 KB do Queues) esse
 *   é o caminho de quase toda nota de voz;
 * - nota de voz de iPhone é `audio/mp4`, e um MP4 chamado `nota.ogg` é recusado
 *   com 400.
 *
 * O container de áudio se identifica nos primeiros bytes. Lê-los é mais curto
 * do que a corrente de fallbacks que eles substituem, e é **verdade** em vez de
 * declaração — por isso a garantia fica aqui e não na negociação de mimetype.
 *
 * Função pura, sem IO: dá para exercitar por `npm run test:audio` sem rede nem
 * `workerd`. Mesmo arranjo de `lib/rag/secoes.ts`.
 */

/** O que a API de transcrição precisa saber: a extensão e o tipo. */
export interface FormatoDeAudio {
    /** Sem ponto. Um dos formatos que `/audio/transcriptions` aceita. */
    ext: string
    mime: string
}

/** `true` se os bytes a partir de `inicio` são exatamente estes caracteres. */
function marca(bytes: Uint8Array, inicio: number, texto: string): boolean {
    if (bytes.length < inicio + texto.length) return false
    for (let i = 0; i < texto.length; i++) {
        if (bytes[inicio + i] !== texto.charCodeAt(i)) return false
    }
    return true
}

/**
 * O formato pelos bytes de abertura, ou `null` se não for reconhecido.
 *
 * Cobre o que chega de WhatsApp e de Instagram. `null` não é erro: é o sinal
 * para o chamador cair no tipo declarado, que pode estar certo.
 */
export function formatoDeAudio(bytes: Uint8Array): FormatoDeAudio | null {
    // Ogg/Opus — a nota de voz padrão do WhatsApp no Android.
    if (marca(bytes, 0, 'OggS')) return { ext: 'ogg', mime: 'audio/ogg' }

    // ISO-BMFF: `ftyp` vem depois do tamanho da caixa, nos bytes 4..8. É o
    // formato do iPhone, e o que mais sofria com o nome `nota.ogg`.
    if (marca(bytes, 4, 'ftyp')) return { ext: 'm4a', mime: 'audio/mp4' }

    // Matroska/WebM — EBML, 1A 45 DF A3.
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
        return { ext: 'webm', mime: 'audio/webm' }
    }

    // MP3 com tag ID3 na frente.
    if (marca(bytes, 0, 'ID3')) return { ext: 'mp3', mime: 'audio/mpeg' }

    // MP3 sem tag: sincronismo de quadro, 11 bits em 1. O segundo byte varia
    // com a versão e a proteção, daí a máscara em vez de uma lista.
    if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
        return { ext: 'mp3', mime: 'audio/mpeg' }
    }

    if (marca(bytes, 0, 'fLaC')) return { ext: 'flac', mime: 'audio/flac' }

    // WAV é RIFF com o tipo `WAVE` — RIFF sozinho também é AVI.
    if (marca(bytes, 0, 'RIFF') && marca(bytes, 8, 'WAVE')) return { ext: 'wav', mime: 'audio/wav' }

    return null
}

/**
 * O formato declarado pelo provedor, quando os bytes não se identificaram.
 *
 * Só reconhece tipo de áudio **de verdade**: `application/octet-stream` devolve
 * `null`, porque era exatamente ele que virava `nota.ogg` e fazia a OpenAI
 * recusar. Ver `DownloadedMedia.mimetype`.
 */
export function formatoDoMimetype(mimetype: string | undefined): FormatoDeAudio | null {
    if (!mimetype) return null
    const tipo = mimetype.split(';')[0].trim().toLowerCase()

    if (tipo === 'audio/ogg' || tipo === 'audio/opus' || tipo === 'audio/vorbis') {
        return { ext: 'ogg', mime: 'audio/ogg' }
    }
    if (tipo === 'audio/mp4' || tipo === 'audio/m4a' || tipo === 'audio/x-m4a') {
        return { ext: 'm4a', mime: 'audio/mp4' }
    }
    if (tipo === 'audio/mpeg' || tipo === 'audio/mp3') return { ext: 'mp3', mime: 'audio/mpeg' }
    if (tipo === 'audio/webm') return { ext: 'webm', mime: 'audio/webm' }
    if (tipo === 'audio/wav' || tipo === 'audio/x-wav' || tipo === 'audio/wave') {
        return { ext: 'wav', mime: 'audio/wav' }
    }
    if (tipo === 'audio/flac' || tipo === 'audio/x-flac') return { ext: 'flac', mime: 'audio/flac' }

    return null
}

/**
 * O palpite de último recurso.
 *
 * Nota de voz de WhatsApp é Ogg/Opus na esmagadora maioria, então chutar `ogg`
 * acerta mais do que recusar a transcrever. Fica nomeado para que a diferença
 * entre "sei" e "chutei" apareça no log.
 */
export const FORMATO_PADRAO: FormatoDeAudio = { ext: 'ogg', mime: 'audio/ogg' }
