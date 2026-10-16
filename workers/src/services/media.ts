import { createAdminClient } from '@/lib/supabase/admin'
import type { ChannelProvider } from '@/lib/whatsapp'
import type { IntegrationConfig } from '@/lib/whatsapp'
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
 * Put inbound media bytes in Supabase Storage and return the public URL.
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
export async function archiveInboundMedia(
    input: ArchiveMediaInput
): Promise<string | null> {
    const { workspaceId, conversationId } = input

    let base64 = input.base64
    let mimetype = input.mimetype

    if (!base64) {
        if (!input.provider || !input.credentials || !input.downloadPayload) {
            log.warn('no inline media and no way to download it')
            return null
        }

        const downloaded = await input.provider.downloadMedia(
            input.credentials,
            input.downloadPayload
        )

        if (!downloaded?.base64) {
            log.warn('provider returned no media bytes')
            return null
        }

        base64 = downloaded.base64
        mimetype = downloaded.mimetype
    }

    // Providers report things like "audio/ogg; codecs=opus"; Storage wants the bare
    // type, and the parameters break extension mapping.
    const cleanMimetype = (mimetype ?? 'application/octet-stream').split(';')[0].trim()
    const path = `${workspaceId}/${conversationId}/${Date.now()}_inbound.${extensionFor(cleanMimetype)}`

    const supabase = createAdminClient()
    const { data, error } = await supabase.storage
        .from(env.SUPABASE_STORAGE_BUCKET)
        .upload(path, Buffer.from(base64, 'base64'), {
            contentType: cleanMimetype,
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
