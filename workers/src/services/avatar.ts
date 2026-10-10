import prisma from '@/lib/prisma'
import { createAdminClient } from '@/lib/supabase/admin'
import { toMsisdn } from '@/lib/whatsapp'
import type { IntegrationConfig, WhatsAppProvider } from '@/lib/whatsapp'

import { env } from '../env'
import { createLogger } from '../logger'

const log = createLogger('AVATAR')

/** Teto da imagem guardada: foto de perfil do WhatsApp não passa disto. */
const MAX_BYTES = 2 * 1024 * 1024
/** Baixar a imagem é rápido ou não vale a pena. */
const DOWNLOAD_TIMEOUT_MS = 8_000

/**
 * Quem já foi tentado neste processo.
 *
 * Sem isto, um paciente sem foto pública seria consultado a cada mensagem — e
 * cada consulta dessas é a que pendura por oito segundos. Memória do processo
 * basta: reiniciar o worker e tentar de novo uma vez é inofensivo, e guardar a
 * tentativa no banco custaria uma coluna para um enfeite.
 */
const tried = new Set<string>()

/**
 * A foto do paciente, dos bytes até a ficha.
 *
 * **Os bytes, não a URL.** O que o WhatsApp devolve é um endereço assinado que
 * expira; guardá-lo deixaria a ficha com uma foto que funciona hoje e quebra na
 * semana que vem. O mesmo caminho da mídia das mensagens: baixa, sobe para o
 * Storage, grava o endereço nosso.
 *
 * Nada aqui é fatal. Falhar em achar a foto é o estado normal de quem não tem
 * foto pública — a ficha mostra as iniciais e está correta.
 */
export async function syncContactAvatar(input: {
    contactId: string
    workspaceId: string
    phone: string | null
    provider: WhatsAppProvider
    credentials: IntegrationConfig
    /** `true` quando o evento disse que a foto foi removida. */
    removed?: boolean
}): Promise<void> {
    const { contactId, workspaceId, phone, provider, credentials, removed } = input

    if (removed) {
        await prisma.contact.update({ where: { id: contactId }, data: { avatar: null } }).catch(() => null)
        tried.delete(contactId)
        return
    }

    if (!provider.getProfilePictureUrl || !phone) return
    if (tried.has(contactId)) return
    tried.add(contactId)

    const url = await provider.getProfilePictureUrl(credentials, phone)
    if (!url) {
        log.info(`no public picture for contact ${contactId}`)
        return
    }

    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
        let bytes: Buffer
        let contentType: string
        try {
            const response = await fetch(url, { signal: controller.signal })
            if (!response.ok) {
                log.warn(`picture download failed for ${contactId}: ${response.status}`)
                return
            }
            contentType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
            bytes = Buffer.from(await response.arrayBuffer())
        } finally {
            clearTimeout(timer)
        }

        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
            log.warn(`picture for ${contactId} has an implausible size: ${bytes.byteLength}`)
            return
        }

        const supabase = createAdminClient()
        const path = `${workspaceId}/avatars/${contactId}.jpg`
        const { data, error } = await supabase.storage
            .from(env.SUPABASE_STORAGE_BUCKET)
            // `upsert`: a foto nova substitui a antiga no mesmo caminho, em vez
            // de deixar um rastro de imagens órfãs a cada troca.
            .upload(path, bytes, { contentType, upsert: true })

        if (error || !data) {
            log.error(`avatar upload failed for ${contactId}`, error?.message)
            return
        }

        const { data: urlData } = supabase.storage
            .from(env.SUPABASE_STORAGE_BUCKET)
            .getPublicUrl(data.path)

        await prisma.contact.update({
            where: { id: contactId },
            data: { avatar: urlData.publicUrl },
        })
        log.info(`avatar stored for contact ${contactId}`)
    } catch (error) {
        log.warn(`avatar sync failed for ${contactId}: ${(error as Error).message}`)
    }
}

/** O contato daquele JID dentro do workspace, ou nada. */
export async function findContactByJid(workspaceId: string, jid: string) {
    const phone = toMsisdn(jid)
    if (!phone) return null
    return prisma.contact.findFirst({
        where: { workspaceId, phone },
        select: { id: true, phone: true, avatar: true },
    })
}
