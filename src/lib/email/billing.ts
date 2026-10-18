import prisma from '@/lib/prisma'
import { sendEmail } from './send'

/**
 * The billing notices: trial running out, trial over, credits nearly spent.
 *
 * They exist so the cut-off is a decision the clinic got to make rather than
 * something that happened to them mid-conversation with a patient. Each one is
 * sent at most once — `notification_logs` carries the idempotency, so a cron that
 * runs twice or catches up after an outage does not warn the same clinic three
 * times, which would read as a broken product at exactly the wrong moment.
 */

export type BillingEmailKind =
    | 'trial_day_5'
    | 'trial_day_6'
    | 'trial_ended'
    | 'credits_80'
    | 'retention_60'
    | 'retention_7'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://odontobox.venn360.com'
const PLANS_URL = `${APP_URL}/gerenciamento/conta?tab=plano`

function formatDate(date: Date | null | undefined): string {
    if (!date) return ''
    return date.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
    })
}

interface Copy {
    subject: string
    headline: string
    body: string[]
    cta: string
    tone: 'neutral' | 'urgent'
}

function copyFor(
    kind: BillingEmailKind,
    context: Record<string, unknown> = {}
): Copy {
    switch (kind) {
        case 'trial_day_5':
            return {
                subject: 'Faltam 2 dias de avaliação · OdontoBox360',
                headline: 'Sua avaliação termina em 2 dias',
                body: [
                    `O período gratuito vai até ${formatDate(context.trialEndsAt as Date)}.`,
                    'Escolhendo um plano antes disso, o atendimento continua sem interrupção — seus agentes, conversas e histórico seguem exatamente como estão.',
                ],
                cta: 'Ver planos',
                tone: 'neutral',
            }
        case 'trial_day_6':
            return {
                subject: 'Sua avaliação termina amanhã · OdontoBox360',
                headline: 'Último dia de avaliação',
                body: [
                    `A avaliação encerra ${formatDate(context.trialEndsAt as Date)}.`,
                    'Depois disso o sistema continua acessível e as mensagens seguem chegando pelo WhatsApp, mas o envio de respostas fica suspenso até a contratação de um plano.',
                    'Nada é apagado, e contratar restabelece tudo na hora.',
                ],
                cta: 'Escolher um plano',
                tone: 'urgent',
            }
        case 'trial_ended':
            return {
                subject: 'Avaliação encerrada · OdontoBox360',
                headline: 'Sua avaliação terminou',
                body: [
                    'Seus dados estão todos aqui e as mensagens continuam chegando normalmente pelo WhatsApp — nada foi perdido nem desconectado.',
                    'O que está suspenso é o envio de respostas e a criação de novos registros. Assinar um plano restabelece tudo imediatamente.',
                    'A exportação dos seus dados continua disponível a qualquer momento.',
                ],
                cta: 'Assinar um plano',
                tone: 'urgent',
            }
        case 'retention_60':
            return {
                subject: 'Seus dados serão removidos em 60 dias · OdontoBox360',
                headline: 'Seus dados ainda estão aqui',
                body: [
                    `Como a assinatura não foi contratada, os dados deste workspace serão removidos em ${formatDate(context.deleteAt as Date)}.`,
                    'Até lá nada muda: tudo continua acessível para consulta e exportação, e contratar um plano a qualquer momento restabelece o atendimento sem perda nenhuma.',
                    'Se preferir levar seus dados, a exportação está disponível nas telas de pacientes e negócios.',
                ],
                cta: 'Manter minha conta ativa',
                tone: 'neutral',
            }
        case 'retention_7':
            return {
                subject: 'Últimos 7 dias antes da remoção · OdontoBox360',
                headline: 'Seus dados serão removidos em 7 dias',
                body: [
                    `A remoção está marcada para ${formatDate(context.deleteAt as Date)} e é definitiva.`,
                    'Se quiser manter o histórico, contrate um plano antes dessa data — ou exporte seus pacientes e negócios enquanto o acesso continua aberto.',
                ],
                cta: 'Contratar um plano',
                tone: 'urgent',
            }
        case 'credits_80': {
            const used = Number(context.creditsUsed ?? 0)
            const total = Number(context.credits ?? 0)
            return {
                subject: 'Seus créditos de IA estão acabando · OdontoBox360',
                headline: '80% dos créditos utilizados',
                body: [
                    `Você usou ${used.toLocaleString('pt-BR')} dos ${total.toLocaleString('pt-BR')} créditos do período.`,
                    'Quando acabarem, o agente para de responder automaticamente e avisa o paciente de que o atendimento continua em instantes. Sua equipe segue respondendo normalmente.',
                ],
                cta: 'Ver créditos',
                tone: 'neutral',
            }
        }
    }
}

/** Same shell as the auth e-mails: tables, inline styles, bulletproof button. */
function render(copy: Copy): string {
    const accent = copy.tone === 'urgent' ? '#c62828' : '#a7f3d0'
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${copy.headline}</title></head>
<body style="margin:0;padding:0;background-color:#f8fbfd;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fbfd;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td align="center" style="padding-bottom:28px;">
<img src="${APP_URL}/logos/logo-wordmark-light.png" width="150" height="50" alt="OdontoBox360" style="display:block;border:0;width:150px;height:auto;">
</td></tr>
<tr><td style="background-color:#ffffff;border:1px solid #dce7ec;border-radius:12px;padding:40px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:44px;height:3px;background-color:${accent};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
<h1 style="margin:22px 0 0;font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;font-weight:700;color:#0b1f3b;letter-spacing:-0.3px;">${copy.headline}</h1>
${copy.body
    .map(
        (p) =>
            `<p style="margin:14px 0 0;font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#53707f;">${p}</p>`
    )
    .join('\n')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 0;"><tr>
<td align="center" bgcolor="#06b6d4" style="border-radius:10px;">
<a href="${PLANS_URL}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#0b1f3b;text-decoration:none;border-radius:10px;">${copy.cta}</a>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;"><tr><td style="height:1px;background-color:#dce7ec;font-size:0;line-height:0;">&nbsp;</td></tr></table>
<p style="margin:20px 0 0;font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#53707f;">Qualquer dúvida, é só responder este e-mail.</p>
</td></tr>
<tr><td align="center" style="padding:24px 8px 0;">
<p style="margin:0;font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8099a8;">OdontoBox360 &middot; atendimento, agenda e CRM para clínicas odontológicas<br>uma solução Venn360</p>
</td></tr></table></td></tr></table></body></html>`
}

export async function sendBillingEmail(input: {
    workspaceId: string
    /**
     * A conta, quando quem avisa é cobrança.
     *
     * Dado: o destinatário de um aviso de cobrança é o MASTER da conta, não o
     * dono de uma unidade qualquer dela. Com três clínicas na mesma assinatura,
     * "o OWNER do workspace" deixa de ter resposta única — e escolher a unidade
     * mais antiga mandaria o aviso para quem talvez não pague nada.
     *
     * `workspaceId` continua obrigatório porque é ele que amarra o registro de
     * envio e o contexto do texto. Com a conta junto, só o destinatário muda.
     */
    accountId?: string
    kind: BillingEmailKind
    /** Makes a recurring notice repeatable — a billing period, typically. */
    scope?: string
    context?: Record<string, unknown>
}): Promise<void> {
    const { workspaceId, accountId, kind, scope = '', context = {} } = input

    // Claim the send before making it. Writing the row first means a crash
    // between the two sends nothing rather than sending twice — for a billing
    // warning, a missed notice is recoverable and a duplicate is not.
    const master = accountId
        ? await prisma.account.findUnique({
            where: { id: accountId },
            select: { owner: { select: { email: true, name: true } } },
        })
        : null

    // Sem MASTER definido, cai no dono da unidade — que é quem recebia antes
    // desta coluna existir, e continua sendo a resposta certa com uma só.
    const owner = master?.owner
        ? null
        : await prisma.workspaceUser.findFirst({
            where: { workspaceId, role: 'OWNER', isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { user: { select: { email: true, name: true } } },
        })

    const to = master?.owner?.email ?? owner?.user?.email
    if (!to) return

    try {
        await prisma.notificationLog.create({
            data: { workspaceId, kind, scope, sentTo: to },
        })
    } catch {
        // Unique violation: already sent. Nothing to do.
        return
    }

    const copy = copyFor(kind, context)
    const result = await sendEmail({ to, subject: copy.subject, html: render(copy) })

    if (!result.ok) {
        // Release the claim so the next run can try again — a warning that was
        // logged but never delivered is worse than one sent late.
        await prisma.notificationLog
            .delete({ where: { workspaceId_kind_scope: { workspaceId, kind, scope } } })
            .catch(() => {})
        console.error('[BILLING_EMAIL]', kind, workspaceId, result.error)
    }
}
