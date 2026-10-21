import { TTS_MODELS } from '@/lib/llm/models'
import { env } from '@/trabalhos/ambiente'
import { createLogger } from '@/trabalhos/registro'
import { CLASSES, arquivar } from './arquivo'

const log = createLogger('SPEECH')

/**
 * Ogg/Opus, e não mp3.
 *
 * É o formato da própria nota de voz do WhatsApp — a mídia que chega de um
 * paciente vem como `audio/ogg; codecs=opus`. Mandando no formato nativo, o
 * áudio aparece como nota de voz tocável em vez de arquivo anexado, e nada
 * depende de o provedor converter com o ffmpeg que ele tem na imagem.
 */
const FORMATO = 'opus'
const MIMETYPE = 'audio/ogg'

export interface FalaGerada {
    url: string
    characters: number
    model: string
}

export interface FalarInput {
    texto: string
    /** Uma das vozes da OpenAI; a tela só oferece as seis que existem. */
    voz: string
    /** Entonação, do campo da aba Voz. Só o `gpt-4o-mini-tts` a aceita. */
    instrucoes?: string | null
    workspaceId: string
    conversationId: string
}

/**
 * Transforma a resposta do agente em nota de voz e devolve a URL pública.
 *
 * **Devolve `null` em vez de lançar** — em qualquer falha: texto longo demais,
 * modelo sem permissão no projeto, OpenAI fora do ar, Storage recusando. Quem
 * chama manda o texto nesses casos. A regra vem do resto do caminho de mídia
 * (`archiveInboundMedia`, `transcribeAudio`): perder o anexo é aceitável,
 * perder a resposta não é — o paciente está esperando alguém falar com ele.
 *
 * O áudio vai para o mesmo balde da mídia que chega, no mesmo formato de
 * caminho, porque é a mesma conversa e a mesma retenção.
 */
export async function falar(input: FalarInput): Promise<FalaGerada | null> {
    const { texto, voz, instrucoes, workspaceId, conversationId } = input

    const apiKey = env.OPENAI_API_KEY
    if (!apiKey) {
        log.warn('sem OPENAI_API_KEY; a resposta vai como texto')
        return null
    }

    const limpo = texto.trim()
    if (!limpo) return null

    if (limpo.length > env.AGENT_SPEECH_MAX_CHARS) {
        log.info(
            `resposta de ${limpo.length} caracteres passa do teto de ` +
                `${env.AGENT_SPEECH_MAX_CHARS}; vai como texto`
        )
        return null
    }

    /**
     * **O que está gravado no agente, e só isso.**
     *
     * Chegou a haver aqui uma âncora de língua embutida, somada por baixo ao
     * que a clínica escrevera. O Andre recusou em 2026-10-20: a instrução de
     * idioma mora na aba Voz, visível. Se o campo estiver vazio, o agente fala
     * sem direção nenhuma — e é a tela que não deixa isso acontecer, semeando
     * o padrão. Ver `lib/voz.ts`.
     */
    const entonacao = instrucoes?.trim() || undefined

    for (const modelo of TTS_MODELS) {
        const corpo: Record<string, unknown> = {
            model: modelo.id,
            voice: voz,
            input: limpo,
            response_format: FORMATO,
        }

        // Mandar `instructions` para quem não aceita é 400 na cara de um modelo
        // que funcionaria sem ele.
        if (entonacao && modelo.acceptsInstructions) corpo.instructions = entonacao

        let bytes: ArrayBuffer
        try {
            const resposta = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(corpo),
            })

            if (!resposta.ok) {
                const detalhe = await resposta.text().catch(() => '')
                // 403 / model_not_found = o projeto não liberou o modelo de voz.
                // Mesmo diagnóstico que a amostra da tela dá, e vale o log alto:
                // é configuração do painel da OpenAI, não defeito nosso.
                log.warn(
                    `${modelo.id} recusou (${resposta.status}): ${detalhe.slice(0, 200)}`
                )
                continue
            }

            bytes = await resposta.arrayBuffer()
        } catch (error) {
            log.warn(`${modelo.id} falhou na chamada`, error)
            continue
        }

        const caminho = `${workspaceId}/${conversationId}/${Date.now()}_fala.ogg`
        // A fala é a resposta clínica da clínica, dita em voz alta. Mesma classe
        // da mensagem que a originou.
        const arquivado = await arquivar({
            classe: CLASSES.CLINICO,
            chave: caminho,
            bytes: new Uint8Array(bytes),
            contentType: MIMETYPE,
        })

        if (!arquivado) return null

        log.info(`fala de ${limpo.length} caractere(s) em ${modelo.id} → ${arquivado.referencia.chave}`)
        return { url: arquivado.url, characters: limpo.length, model: modelo.id }
    }

    log.warn('nenhum modelo de fala respondeu; a resposta vai como texto')
    return null
}

export const MIMETYPE_DA_FALA = MIMETYPE
