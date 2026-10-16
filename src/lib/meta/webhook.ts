import crypto from 'node:crypto'

import { getPlatformCredentials } from '@/lib/platform-credentials'
import { readVaultSecret } from '@/lib/vault'

/** O provedor de plataforma a que o WhatsApp e o Instagram pertencem. */
export const META_PROVIDER = 'meta_messaging'

/** Nome do segredo do token de verificação, no Vault. */
export const META_VERIFY_TOKEN_SECRET = `platform:${META_PROVIDER}:verifyToken`

/**
 * O token que a Meta devolve no aperto de mão.
 *
 * Não é segredo no mesmo sentido da chave do aplicativo — ele não autoriza
 * nada. Serve para que ninguém registre um webhook no nosso lugar, e mora no
 * Vault junto com o resto só para não haver valor de configuração espalhado por
 * arquivos.
 */
export async function metaVerifyToken(): Promise<string | null> {
    return readVaultSecret(META_VERIFY_TOKEN_SECRET)
}

/**
 * Confere a assinatura que a Meta põe em cada evento.
 *
 * **Sobre os bytes crus, nunca sobre o objeto reserializado.** Converter para
 * objeto e voltar para texto reordena chaves e mexe em espaços — e a assinatura
 * passa a não bater nunca. É a causa número um de falha nesta integração, e o
 * motivo de esta função receber `string` e não `unknown`.
 *
 * Comparação em tempo constante: comparar com `===` vaza, pelo tempo de resposta,
 * quantos caracteres do início bateram, e isso é o bastante para alguém montar
 * uma assinatura válida tentativa a tentativa.
 */
export function metaSignatureValid(rawBody: string, header: string | null, appSecret: string): boolean {
    if (!header?.startsWith('sha256=')) return false

    const esperado = crypto
        .createHmac('sha256', appSecret)
        .update(rawBody, 'utf8')
        .digest('hex')

    const recebido = header.slice('sha256='.length)

    // `timingSafeEqual` exige o mesmo comprimento, e estourar com tamanhos
    // diferentes seria vazar o comprimento. Assinatura de tamanho errado é
    // inválida, e pronto.
    if (recebido.length !== esperado.length) return false

    return crypto.timingSafeEqual(Buffer.from(recebido, 'utf8'), Buffer.from(esperado, 'utf8'))
}

/** A chave secreta do aplicativo, do Vault. Nula quando ainda não foi registrada. */
export async function metaAppSecret(): Promise<string | null> {
    const creds = await getPlatformCredentials(META_PROVIDER)
    return creds?.clientSecret ?? null
}

export interface MetaEventoNormalizado {
    /** "whatsapp" ou "instagram", pelo campo `object` do corpo. */
    canal: string
    /** Conta de negócio do WhatsApp, ou id da conta do Instagram. */
    contaId: string | null
    /** Número da clínica, no WhatsApp. Nulo no Instagram. */
    numeroId: string | null
    /** "messages", "account_update"… o que mudou. */
    campo: string | null
}

/** `true` quando o corpo é do Instagram, que tem forma própria. */
export function ehEventoDeInstagram(corpo: unknown): boolean {
    return (corpo as { object?: string } | null)?.object === 'instagram'
}

/**
 * Reduz o corpo da Meta ao que nos interessa para rotear.
 *
 * A Meta dá **uma URL só para todas as clínicas**: os eventos de todo mundo
 * caem aqui, e somos nós que levamos cada um ao workspace certo. O que
 * identifica a clínica é o id da conta — `waba_id` no WhatsApp, id da conta no
 * Instagram —, e é por ele que a tabela de ligação vai funcionar quando o fluxo
 * de conectar existir.
 *
 * **Dois formatos, não um.** O WhatsApp Cloud API manda
 * `entry[].changes[].value`; o Instagram Direct manda no formato do Messenger,
 * `entry[].messaging[]`, com `sender`, `recipient` e `message`. A primeira
 * versão disto lia só `changes` — e por isso toda mensagem de Instagram
 * resumia-se a campos nulos, sem erro e sem log útil, o que é o pior jeito de
 * falhar. Quem traduz o Direct de verdade é `lib/instagram/webhook.ts`; aqui
 * fica o resumo que vai para o log e serve aos dois.
 *
 * Tolerante de propósito: formato que não reconhecemos vira campos nulos e um
 * log, nunca uma exceção. Webhook que estoura é webhook que a Meta reenvia por
 * sete dias.
 */
export function normalizarEventoMeta(corpo: unknown): MetaEventoNormalizado {
    const raiz = (corpo ?? {}) as Record<string, unknown>
    const entrada = Array.isArray(raiz.entry) ? (raiz.entry[0] as Record<string, unknown>) : undefined

    const canal = typeof raiz.object === 'string' ? raiz.object : 'desconhecido'
    const contaId = typeof entrada?.id === 'string' ? entrada.id : null

    // Instagram: a entrada traz `messaging`, e o "campo" é o tipo do item.
    if (Array.isArray(entrada?.messaging)) {
        const item = (entrada!.messaging[0] ?? {}) as Record<string, unknown>
        const campo = item.message
            ? 'message'
            : item.reaction
              ? 'reaction'
              : item.read
                ? 'read'
                : item.postback
                  ? 'postback'
                  : null

        return { canal, contaId, numeroId: null, campo }
    }

    const mudanca = Array.isArray(entrada?.changes)
        ? (entrada!.changes[0] as Record<string, unknown>)
        : undefined
    const valor = (mudanca?.value ?? {}) as Record<string, unknown>
    const metadata = (valor.metadata ?? {}) as Record<string, unknown>

    return {
        canal,
        contaId,
        numeroId: typeof metadata.phone_number_id === 'string' ? metadata.phone_number_id : null,
        campo: typeof mudanca?.field === 'string' ? mudanca.field : null,
    }
}
