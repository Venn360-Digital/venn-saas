import { createLogger } from '@/trabalhos/registro'

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
 */
export const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'

export async function transcribeAudio(base64: string, mimetype: string | undefined): Promise<string | null> {
    const key = process.env.OPENAI_API_KEY
    if (!key) {
        log.warn('OPENAI_API_KEY ausente; áudio não transcrito')
        return null
    }

    const mime = mimetype || 'audio/ogg'
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('webm') ? 'webm' : 'ogg'

    const form = new FormData()
    form.append('model', TRANSCRIBE_MODEL)
    form.append('language', 'pt')
    form.append('response_format', 'text')
    form.append('file', new Blob([Buffer.from(base64, 'base64')], { type: mime }), `nota.${ext}`)

    const started = Date.now()
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
    })

    if (!response.ok) {
        const body = (await response.text()).slice(0, 200)
        // 403 model_not_found = o projeto não liberou o modelo. Avisa alto, uma vez por job.
        log.warn(`transcrição indisponível (${response.status}): ${body}`)
        return null
    }

    const text = (await response.text()).trim()
    log.info(`nota de voz transcrita em ${Date.now() - started}ms (${text.length} chars)`)
    return text || null
}
