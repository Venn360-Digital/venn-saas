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
 * Desiste do endpoint depois de algumas recusas seguidas.
 *
 * Medido em 2026-10-10 contra a instância de produção: `POST /user/avatar`
 * responde **500 `info query timed out` depois de 75 s**, para um número com
 * foto e conversa aberta, nos dois modos de `preview`. `/user/info` também
 * pendura; `/user/check`, no mesmo socket, responde em 0,4 s — ou seja, a
 * sessão está boa e são as consultas de perfil que esta versão da imagem não
 * consegue fazer.
 *
 * Enquanto isso não muda, cada tentativa custa oito segundos de um worker para
 * um enfeite que não vem. Três recusas seguidas desligam a busca até o próximo
 * reinício, que é quando uma imagem nova teria entrado.
 */
const MAX_CONSECUTIVE_FAILURES = 3
let consecutiveFailures = 0

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
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return
    if (tried.has(contactId)) return
    tried.add(contactId)

    const url = await provider.getProfilePictureUrl(credentials, phone)
    if (!url) {
        consecutiveFailures += 1
        // "Não consegui saber", e não "não tem foto": são estados diferentes e
        // confundi-los já produziu uma afirmação falsa com cara de certeza
        // ("este número não tem WhatsApp") na verificação de número.
        log.info(
            `could not read a picture for contact ${contactId}` +
                (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
                    ? ' — desistindo até o próximo reinício do worker'
                    : '')
        )
        return
    }
    consecutiveFailures = 0

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
