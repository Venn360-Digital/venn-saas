import { createAdminClient } from '@/lib/supabase/admin'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'
import { env } from '../env'
import { createLogger } from '../logger'

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
    instanceName: string
    key: unknown
    messagePayload: unknown
    workspaceId: string
    conversationId: string
}

/**
 * Pull the media bytes out of Evolution and park them in Supabase Storage.
 *
 * WhatsApp media URLs are encrypted and short-lived, so the bytes have to be
 * fetched through Evolution (`getBase64FromMediaMessage`) and re-hosted. Doing
 * this in a worker is the whole point of the queue: an audio note used to add
 * seconds to the webhook request before the agent could even start answering.
 *
 * Returns null on failure — the caller keeps the original (probably unusable)
 * URL rather than losing the message.
 */
export async function archiveInboundMedia(
    input: ArchiveMediaInput
): Promise<string | null> {
    const { instanceName, key, messagePayload, workspaceId, conversationId } = input

    const media = await evolutionAPI.getBase64FromMediaMessage(
        instanceName,
        key as never,
        messagePayload as never
    )

    if (!media?.base64) {
        log.warn('Evolution returned no base64 payload')
        return null
    }

    // Evolution reports things like "audio/ogg; codecs=opus"; Storage wants the
    // bare type and the parameters break extension mapping.
    const mimetype = media.mimetype.split(';')[0].trim()
    const path = `${workspaceId}/${conversationId}/${Date.now()}_inbound.${extensionFor(mimetype)}`

    const supabase = createAdminClient()
    const { data, error } = await supabase.storage
        .from(env.SUPABASE_STORAGE_BUCKET)
        .upload(path, Buffer.from(media.base64, 'base64'), {
            contentType: mimetype,
            upsert: false,
        })

    if (error || !data) {
        log.error('storage upload failed', error?.message)
        return null
    }

    const { data: urlData } = supabase.storage
        .from(env.SUPABASE_STORAGE_BUCKET)
        .getPublicUrl(data.path)

    log.info(`archived media at ${data.path}`)
    return urlData.publicUrl
}
