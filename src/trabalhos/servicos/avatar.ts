import prisma from '@/lib/prisma'
import { toMsisdn } from '@/lib/whatsapp'
import type { IntegrationConfig, ChannelProvider } from '@/lib/whatsapp'
import { NOME_PROVISORIO_INSTAGRAM } from './conversation'

import { createLogger } from '@/trabalhos/registro'
import { CLASSES, arquivar } from './arquivo'

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
 * O perfil do paciente — foto e, quando o canal não o manda, o nome.
 *
 * **Os bytes, não a URL.** O que o WhatsApp devolve é um endereço assinado que
 * expira; guardá-lo deixaria a ficha com uma foto que funciona hoje e quebra na
 * semana que vem. O mesmo caminho da mídia das mensagens: baixa, sobe para o
 * Storage, grava o endereço nosso.
 *
 * **O nome só existe aqui por causa do Instagram.** O webhook do Direct manda o
 * IGSID e nada mais: nem nome, nem @. Sem esta consulta a ficha nasceria
 * chamada "Instagram (sem nome ainda)" e ficaria assim para sempre, e a caixa
 * de entrada viraria uma lista de desconhecidos. No WhatsApp o nome de exibição
 * vem no próprio evento, e este caminho não mexe nele.
 *
 * E só substitui o **nome provisório**: um nome que a clínica digitou na ficha
 * não é sobrescrito pelo @ da conta a cada reinício do worker.
 *
 * Nada aqui é fatal. Falhar em achar a foto é o estado normal de quem não tem
 * foto pública — a ficha mostra as iniciais e está correta.
 */
export async function syncContactProfile(input: {
    contactId: string
    workspaceId: string
    /** O id do paciente no canal: MSISDN no WhatsApp, IGSID no Instagram. */
    externalId: string | null
    provider: ChannelProvider
    credentials: IntegrationConfig
    /** O nome que está na ficha agora, para só trocar o provisório. */
    currentName?: string | null
    /** `true` quando o evento disse que a foto foi removida. */
    removed?: boolean
}): Promise<void> {
    const { contactId, workspaceId, externalId, provider, credentials, currentName, removed } =
        input

    if (removed) {
        await prisma.contact.update({ where: { id: contactId }, data: { avatar: null } }).catch(() => null)
        tried.delete(contactId)
        return
    }

    if (!externalId) return
    if (!provider.getContactProfile && !provider.getProfilePictureUrl) return
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return
    if (tried.has(contactId)) return
    tried.add(contactId)

    /**
     * Uma consulta, duas respostas.
     *
     * Onde o provedor sabe dizer nome e foto de uma vez (Instagram), é uma
     * chamada só. Onde ele só sabe a foto (WhatsApp), é o caminho de antes.
     */
    let url: string | undefined
    if (provider.getContactProfile) {
        const perfil = await provider.getContactProfile(credentials, externalId)
        url = perfil?.profilePicUrl

        if (perfil?.name && ehNomeProvisorio(currentName)) {
            await prisma.contact
                .update({ where: { id: contactId }, data: { name: perfil.name } })
                .then(() => log.info(`contact ${contactId} named ${perfil.name}`))
                .catch((error) => log.warn(`could not name contact ${contactId}`, error))
        }
    } else if (provider.getProfilePictureUrl) {
        url = await provider.getProfilePictureUrl(credentials, externalId)
    }

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

        // Caminho estável por contato: a foto nova substitui a antiga, em vez de
        // deixar um rastro de imagens órfãs a cada troca.
        const path = `${workspaceId}/avatars/${contactId}.jpg`

        // Foto de perfil identifica o paciente. Não é `PUBLICO`.
        const arquivado = await arquivar({
            classe: CLASSES.CLINICO,
            chave: path,
            bytes: new Uint8Array(bytes),
            contentType,
        })

        if (!arquivado) return

        await prisma.contact.update({
            where: { id: contactId },
            data: { avatar: arquivado.url },
        })
        log.info(`avatar stored for contact ${contactId}`)
    } catch (error) {
        log.warn(`avatar sync failed for ${contactId}: ${(error as Error).message}`)
    }
}

/**
 * Se o nome da ficha é o que nós mesmos pusemos por falta de outro.
 *
 * Só estes são trocáveis: o provisório do Instagram, o "WhatsApp <número>" que
 * nasce quando o evento não trouxe nome de exibição, e o vazio. Qualquer outro
 * foi escolhido por alguém, e sobrescrevê-lo seria desfazer trabalho da clínica.
 */
function ehNomeProvisorio(nome: string | null | undefined): boolean {
    const limpo = nome?.trim()
    if (!limpo) return true
    return limpo === NOME_PROVISORIO_INSTAGRAM || /^WhatsApp \d+$/.test(limpo)
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
