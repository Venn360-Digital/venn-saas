import { createLogger } from '../registro'
import { OPENAI_BASE_URL } from '../../lib/llm/base-url'
import { deBase64 } from './arquivo'
import { FORMATO_PADRAO, formatoDeAudio, formatoDoMimetype } from '../../lib/audio/formato'

const log = createLogger('TRANSCRIBE')

/**
 * Transcreve uma nota de voz recebida.
 *
 * Importa para duas pessoas: a atendente, que não consegue ouvir áudio com um
 * paciente na frente; e o agente, que até aqui recebia só "🎵 Áudio" e
 * respondia às cegas. Com o texto, a nota de voz vira uma mensagem como outra
 * qualquer para o LLM.
 *
 * `gpt-4o-mini-transcribe` é o mais barato do catálogo (~US$0,003/min). O
 * projeto da chave precisa permiti-lo na allowlist; sem isso a API responde 403
 * `model_not_found`, e aqui isso vira um aviso e um `null` — a mensagem segue
 * sem transcrição, nunca sem ser gravada.
 *
 * ## O defeito de 23/10, consertado aqui
 *
 * Em 29/10 as notas de voz da Implante Já voltaram 400 em ~500 ms, e o agente
 * respondeu que não conseguia entender o áudio. Não foi a troca de LLM nem o
 * gateway: foi o dia em que o base64 passou a **sair do job** quando o evento
 * não cabe nos 128 KB do Queues. Desde então quase toda nota de voz chega pelo
 * `/message/downloadmedia` do Evolution Go, e esse caminho trazia dois vícios
 * que só se manifestavam ali:
 *
 * 1. **o base64 do download não é o padrão** — prefixo de data URL, alfabeto
 *    URL-safe, quebras de linha. `deBase64` já normalizava isso para o
 *    arquivamento desde 23/10, mas aqui o `Buffer.from(base64, 'base64')` cru
 *    seguia decodificando **torto e em silêncio**: áudio de lixo, 400 na hora;
 * 2. **o tipo vinha vazio** e virava `application/octet-stream`, que fazia o
 *    arquivo ser enviado como `nota.ogg` — mentira para áudio de iPhone.
 *
 * Os dois consertos são de natureza diferente e os dois ficam: o primeiro usa o
 * decodificador que já existia; o segundo troca a declaração pela **leitura dos
 * bytes** (`lib/audio/formato.ts`), que é verdade e não palpite.
 */
export const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'

export async function transcribeAudio(base64: string, mimetype: string | undefined): Promise<string | null> {
    const key = process.env.OPENAI_API_KEY
    if (!key) {
        log.warn('OPENAI_API_KEY ausente; áudio não transcrito')
        return null
    }

    /**
     * O mesmo decodificador do arquivamento, e não `Buffer.from`.
     *
     * Ele lança em base64 impossível, e isso vira um aviso com o motivo em vez
     * de um 400 obscuro da OpenAI dez linhas abaixo.
     */
    // `<ArrayBuffer>` e não `Uint8Array` solto: é o que o `Blob` exige, e é o
    // que `deBase64` já garante.
    let bytes: Uint8Array<ArrayBuffer>
    try {
        bytes = deBase64(base64)
    } catch (erro) {
        log.warn(`base64 do áudio não decodifica; áudio não transcrito`, erro)
        return null
    }

    if (bytes.byteLength === 0) {
        log.warn('áudio vazio; nada a transcrever')
        return null
    }

    // Lido > declarado > chutado, nesta ordem, e a origem vai para o log: sem
    // ela um 400 futuro volta a ser indistinguível de allowlist ou de rede.
    const lido = formatoDeAudio(bytes)
    const formato = lido ?? formatoDoMimetype(mimetype) ?? FORMATO_PADRAO
    const origem = lido ? 'bytes' : formatoDoMimetype(mimetype) ? 'mimetype' : 'padrão'

    const form = new FormData()
    form.append('model', TRANSCRIBE_MODEL)
    form.append('language', 'pt')
    form.append('response_format', 'text')
    form.append('file', new Blob([bytes], { type: formato.mime }), `nota.${formato.ext}`)

    const started = Date.now()
    const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
    })

    if (!response.ok) {
        const body = (await response.text()).slice(0, 200)
        // 403 model_not_found = o projeto não liberou o modelo. Avisa alto, uma vez por job.
        // O formato e a origem dele entram no aviso porque foram a causa do 400 de 29/10.
        log.warn(
            `transcrição indisponível (${response.status}): ${body} ` +
            `[${formato.mime} por ${origem}, ${bytes.byteLength} bytes, declarado "${mimetype ?? '—'}"]`
        )
        return null
    }

    const text = (await response.text()).trim()
    log.info(
        `nota de voz transcrita em ${Date.now() - started}ms ` +
        `(${text.length} chars, ${formato.ext} por ${origem})`
    )
    return text || null
}
