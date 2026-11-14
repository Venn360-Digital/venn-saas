import type { ChannelProvider } from '../../lib/whatsapp'
import type { IntegrationConfig } from '../../lib/whatsapp'
import { createLogger } from '../registro'
import { CLASSES, arquivar, deBase64 } from './arquivo'
import { comoReferencia } from '../../lib/midia'

const log = createLogger('MEDIA')

const MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'mp4',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
}

function extensionFor(mimetype: string): string {
    return MIME_TO_EXT[mimetype] || mimetype.split('/').pop() || 'bin'
}

export interface ArchiveMediaInput {
    workspaceId: string
    conversationId: string
    /** Bytes the provider inlined on the webhook, when present. */
    base64?: string
    mimetype?: string
    /** Fallback: fetch from the provider when the bytes were not inlined. */
    provider?: ChannelProvider
    credentials?: IntegrationConfig
    downloadPayload?: Record<string, unknown>
}

/**
 * Put inbound media bytes in object storage and return the reference.
 *
 * Evolution Go inlines the base64 on the webhook (`WEBHOOKFILES=true`), so the
 * common path is a plain upload with no provider round trip — which is why media
 * no longer delays the agent's reply. The download fallback covers the two cases
 * where bytes do not arrive: a payload too large to queue inline, and Evolution v2,
 * which never inlines.
 *
 * Returns null on failure; the caller keeps the message and drops the attachment
 * rather than losing both.
 */
export interface BytesDaMidia {
    base64: string
    mimetype?: string
}

/**
 * Os bytes da mídia: os que vieram no evento ou, sem eles, os baixados.
 *
 * Separado de `archiveInboundMedia` porque há **dois** consumidores dos bytes
 * — o arquivamento e a transcrição de áudio — e o download tem de acontecer
 * uma vez só. Desde 2026-10-23 o base64 sai do job quando o evento não cabe
 * nos 128 KB do Queues (ver `enqueue-whatsapp.ts`), então "sem bytes no
 * evento" deixou de ser exceção: é toda foto e quase toda nota de voz.
 */
export async function obterBytesDaMidia(
    input: Pick<ArchiveMediaInput, 'base64' | 'mimetype' | 'provider' | 'credentials' | 'downloadPayload'>
): Promise<BytesDaMidia | null> {
    if (input.base64) return { base64: input.base64, mimetype: input.mimetype }

    if (!input.provider || !input.credentials || !input.downloadPayload) {
        log.warn('no inline media and no way to download it')
        return null
    }

    const downloaded = await input.provider.downloadMedia(input.credentials, input.downloadPayload)

    if (!downloaded?.base64) {
        log.warn('provider returned no media bytes')
        return null
    }

    // O download do Evolution Go às vezes não informa o mimetype, e o fallback
    // `application/octet-stream` fazia a foto ser gravada como
    // `…_inbound.octet-stream` e servida com Content-Type genérico — o que a
    // joga para a aba de arquivos em vez de abrir como imagem. O envelope do
    // webhook trazia o tipo certo (`image/jpeg`): é ele o fallback.
    return { base64: downloaded.base64, mimetype: downloaded.mimetype ?? input.mimetype }
}

export async function archiveInboundMedia(
    input: ArchiveMediaInput
): Promise<string | null> {
    const { workspaceId, conversationId } = input

    const bytes = await obterBytesDaMidia(input)
    if (!bytes) return null
    const { base64, mimetype } = bytes

    // Providers report things like "audio/ogg; codecs=opus"; Storage wants the bare
    // type, and the parameters break extension mapping.
    const cleanMimetype = (mimetype ?? 'application/octet-stream').split(';')[0].trim()
    const path = `${workspaceId}/${conversationId}/${Date.now()}_inbound.${extensionFor(cleanMimetype)}`

    // Mídia que o paciente mandou é conteúdo clínico — foto de um dente, nota
    // de voz sobre um sintoma. Nunca `PUBLICO`.
    const arquivado = await arquivar({
        classe: CLASSES.CLINICO,
        chave: path,
        bytes: deBase64(base64),
        contentType: cleanMimetype,
    })

    if (!arquivado) return null

    log.info(`archived media at ${arquivado.referencia.chave}`)

    /**
     * A **referência**, não o endereço. O endereço é assinado e vale 600 s;
     * gravá-lo deixava o arquivo morto dez minutos depois e punha uma chave ao
     * portador no banco. Ver `lib/midia.ts`.
     */
    return comoReferencia(arquivado.referencia)
}
