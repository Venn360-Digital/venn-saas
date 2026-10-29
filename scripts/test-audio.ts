/**
 * Os casos do reconhecimento de formato de áudio.
 *
 *   npm run test:audio
 *
 * Existem por causa de um defeito que não parecia defeito: a nota de voz era
 * recusada pela OpenAI com 400 e o agente respondia ao paciente que não
 * conseguia entender o áudio. A causa era o formato ser **declarado** em vez de
 * lido — e o palpite de último recurso (`ogg`) estar errado justamente para
 * áudio de iPhone.
 *
 * Os bytes de abertura de cada container são montados à mão aqui: dá para
 * exercitar a decisão inteira sem rede, sem chave e sem áudio de paciente.
 */
import { FORMATO_PADRAO, formatoDeAudio, formatoDoMimetype } from '@/lib/audio/formato'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) {
        passou++
        console.log(`  ok  ${nome}`)
    } else {
        falhou++
        console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`)
    }
}

/** Bytes a partir de texto ASCII, com rabicho, como um arquivo de verdade. */
function comMarca(prefixo: number[], texto: string, offset = 0): Uint8Array {
    const corpo = [...prefixo]
    for (let i = 0; i < offset - prefixo.length; i++) corpo.push(0)
    for (const c of texto) corpo.push(c.charCodeAt(0))
    while (corpo.length < 32) corpo.push(0x42)
    return new Uint8Array(corpo)
}

function deTexto(texto: string): Uint8Array {
    return comMarca([], texto)
}

console.log('\nLido dos bytes — o que substituiu o palpite')

conferir('Ogg/Opus, a nota de voz do Android', formatoDeAudio(deTexto('OggS')), {
    ext: 'ogg',
    mime: 'audio/ogg',
})

// O caso que motivou tudo: ISO-BMFF tem `ftyp` no byte 4, não no 0.
conferir(
    'MP4/m4a do iPhone — ftyp no offset 4, não no 0',
    formatoDeAudio(comMarca([0, 0, 0, 0x20], 'ftypM4A ', 4)),
    { ext: 'm4a', mime: 'audio/mp4' }
)

conferir(
    'WebM/Matroska pelo EBML',
    formatoDeAudio(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])),
    { ext: 'webm', mime: 'audio/webm' }
)

conferir('MP3 com tag ID3', formatoDeAudio(deTexto('ID3')), { ext: 'mp3', mime: 'audio/mpeg' })

conferir(
    'MP3 sem tag, pelo sincronismo de quadro',
    formatoDeAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x00])),
    { ext: 'mp3', mime: 'audio/mpeg' }
)

conferir('FLAC', formatoDeAudio(deTexto('fLaC')), { ext: 'flac', mime: 'audio/flac' })

conferir('WAV é RIFF **com** WAVE no byte 8', formatoDeAudio(comMarca([], 'RIFF    WAVE')), {
    ext: 'wav',
    mime: 'audio/wav',
})

console.log('\nO que não deve ser reconhecido — null é o sinal de "não sei"')

conferir('RIFF sem WAVE (um AVI) não vira wav', formatoDeAudio(comMarca([], 'RIFF    AVI ')), null)
conferir('bytes vazios', formatoDeAudio(new Uint8Array([])), null)
conferir('curto demais para qualquer marca', formatoDeAudio(new Uint8Array([0x4f])), null)
conferir('lixo', formatoDeAudio(deTexto('nada disso')), null)

// Era este o caminho real da falha: base64 decodificado torto não casa com
// nenhum container, e aí a origem passa a ser o mimetype — não mais o chute.
conferir('ftyp no byte 0 não é ISO-BMFF', formatoDeAudio(deTexto('ftypM4A ')), null)

console.log('\nDeclarado pelo provedor — o segundo recurso')

conferir('audio/ogg', formatoDoMimetype('audio/ogg'), { ext: 'ogg', mime: 'audio/ogg' })
conferir('com parâmetro de codec', formatoDoMimetype('audio/ogg; codecs=opus'), {
    ext: 'ogg',
    mime: 'audio/ogg',
})
conferir('maiúsculas e espaços', formatoDoMimetype('  AUDIO/MP4  '), {
    ext: 'm4a',
    mime: 'audio/mp4',
})
conferir('audio/mpeg', formatoDoMimetype('audio/mpeg'), { ext: 'mp3', mime: 'audio/mpeg' })
conferir('audio/x-m4a', formatoDoMimetype('audio/x-m4a'), { ext: 'm4a', mime: 'audio/mp4' })

console.log('\nO octet-stream — a declaração que causou o 400')

conferir(
    'application/octet-stream não é formato',
    formatoDoMimetype('application/octet-stream'),
    null
)
conferir('mimetype ausente', formatoDoMimetype(undefined), null)
conferir('string vazia', formatoDoMimetype(''), null)
conferir('tipo de imagem não vira áudio', formatoDoMimetype('image/jpeg'), null)

console.log('\nA ordem de decisão, como `transcribeAudio` a aplica')

function decidir(bytes: Uint8Array, mimetype: string | undefined) {
    const lido = formatoDeAudio(bytes)
    const formato = lido ?? formatoDoMimetype(mimetype) ?? FORMATO_PADRAO
    const origem = lido ? 'bytes' : formatoDoMimetype(mimetype) ? 'mimetype' : 'padrão'
    return { ext: formato.ext, origem }
}

// O caso do defeito, ponta a ponta: iPhone pelo download do Evolution Go, que
// não informa tipo. Antes virava `nota.ogg`; agora os bytes mandam.
conferir(
    'MP4 sem mimetype (download do Evolution Go) → m4a pelos bytes',
    decidir(comMarca([0, 0, 0, 0x20], 'ftypM4A ', 4), undefined),
    { ext: 'm4a', origem: 'bytes' }
)

conferir(
    'os bytes vencem um mimetype que discorda',
    decidir(comMarca([0, 0, 0, 0x20], 'ftypM4A ', 4), 'application/octet-stream'),
    { ext: 'm4a', origem: 'bytes' }
)

conferir(
    'bytes irreconhecíveis caem no mimetype declarado',
    decidir(deTexto('lixo'), 'audio/ogg; codecs=opus'),
    { ext: 'ogg', origem: 'mimetype' }
)

conferir(
    'sem bytes e sem tipo, o chute fica nomeado como chute',
    decidir(deTexto('lixo'), 'application/octet-stream'),
    { ext: 'ogg', origem: 'padrão' }
)

console.log(`\n${passou} ok, ${falhou} falhas\n`)
if (falhou > 0) process.exit(1)
