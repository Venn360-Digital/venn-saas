/**
 * Transactional e-mail, through Cloudflare Email Sending.
 *
 * Binding `EMAIL` alcançado via `env` em route handlers ou Durable Objects.
 * Rate limit em memória de Worker (5 envios por 60 segundos por IP), obrigatório
 * para evitar relay aberto.
 *
 * O `env` pode ser passado explicitamente ou será recuperado do registro global
 * (`registrarEmailEnv()` em `entrada.ts`).
 */

import { obterEmailEnv, type EmailEnvRegistry } from './env-registry'

export interface SendResult {
    ok: boolean
    id?: string
    error?: string
}

export async function sendEmail(
    input: {
        to: string
        subject: string
        html: string
    },
    env?: EmailEnvRegistry
): Promise<SendResult> {
    try {
        // Se env não foi passado, recupera do registro global.
        // Dentro de Workers (crons, filas, etc), é registrado em `entrada.ts`.
        const emailEnv = env || obterEmailEnv()

        // Rate limit ANTES de qualquer tentativa de envio.
        // Sem IP (improvável em produção), usa fallback genérico.
        const ip = emailEnv.CF_CONNECTING_IP ?? 'fallback'
        const { success } = await emailEnv.EMAIL_RATELIMIT.limit({ key: `email:${ip}` })
        if (!success) {
            return { ok: false, error: 'Muitas tentativas de envio.' }
        }

        // `from` como { email, name }, nunca como string "Nome <email>".
        // O binding não parseia esse formato — ver skill cloudflare-email-sending.
        const [email, name] = parseEmailFrom(emailEnv.EMAIL_FROM)

        // Sempre enviar texto + HTML: e-mail só-HTML pesa contra a reputação
        // de um domínio de envio novo.
        const text = stripHtmlTags(input.html)

        await emailEnv.EMAIL.send({
            from: { email, name },
            to: [{ email: input.to }],
            subject: input.subject,
            text,
            html: input.html,
        })

        // Sucesso: o binding não devolve ID, mas marca que saiu.
        return { ok: true }
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'falha de rede'

        // Se o erro carregar `code`, é da API do Email Sending:
        // `E_SENDER_NOT_VERIFIED`, `E_RATE_LIMIT_EXCEEDED`, etc.
        const code = (error as any).code ? ` (${(error as any).code})` : ''

        return { ok: false, error: `${msg}${code}` }
    }
}

function parseEmailFrom(emailFrom: string): [string, string] {
    // Formato esperado: "Nome <email@domain>" ou "email@domain"
    const match = emailFrom.match(/^(.+?)\s*<(.+?)>$/)
    if (match) {
        return [match[2], match[1]]
    }
    return [emailFrom, 'OdontoBox360']
}

function stripHtmlTags(html: string): string {
    // Remove tags HTML para gerar versão texto.
    // Quebra em novas linhas e remove espaços extras.
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join('\n')
}
