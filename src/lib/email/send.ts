/**
 * Transactional e-mail, through Resend's HTTP API.
 *
 * No SDK: the call is one POST, and a dependency for that is weight the build on
 * a 2 vCPU box does not need to carry. SMTP would also work — GoTrue already
 * uses it for auth mail — but the HTTP API gives a message id and a readable
 * error, which matters when a billing warning quietly fails to arrive.
 */

const ENDPOINT = 'https://api.resend.com/emails'

export interface SendResult {
    ok: boolean
    id?: string
    error?: string
}

export async function sendEmail(input: {
    to: string
    subject: string
    html: string
}): Promise<SendResult> {
    const key = process.env.RESEND_API_KEY
    if (!key) {
        // Not an exception: a missing key must not take down the cron that was
        // only trying to warn someone. It is logged and skipped.
        return { ok: false, error: 'RESEND_API_KEY ausente' }
    }

    const from = process.env.EMAIL_FROM ?? 'OdontoBox360 <odontobox360@mail.venn360.com>'

    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
        })

        const body = (await response.json().catch(() => ({}))) as {
            id?: string
            message?: string
        }

        if (!response.ok) {
            return { ok: false, error: body.message ?? `HTTP ${response.status}` }
        }
        return { ok: true, id: body.id }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'falha de rede' }
    }
}
