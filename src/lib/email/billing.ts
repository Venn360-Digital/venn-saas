import prisma from '@/lib/prisma'
import { sendEmail } from './send'
import { renderEmail } from '@/lib/email/layout'

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
    /** Cobrança vencida: começou a carência, e ela tem data. */
    | 'payment_overdue'
    /** A carência acabou e a clínica ficou em somente-leitura. */
    | 'access_suspended'

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
        case 'payment_overdue':
            return {
                subject: 'Cobrança vencida · OdontoBox360',
                headline: 'Sua mensalidade está em aberto',
                body: [
                    `A cobrança de ${context.valor as string} venceu em ${context.vencimento as string}.`,
                    /* A carência é o que esta mensagem existe para contar. Um
                       aviso de atraso sem prazo vira susto; com prazo, vira
                       instrução — e o cliente sabe que ainda dá tempo. */
                    `Você tem até ${context.ate as string} para pagar sem interrupção. Depois dessa data a clínica fica em somente-leitura: as mensagens continuam chegando e o histórico fica inteiro, mas o envio e o agente param.`,
                    'Se já pagou nas últimas horas, pode ignorar — a confirmação do banco leva alguns minutos.',
                ],
                cta: 'Ver a fatura',
                tone: 'urgent',
            }
        case 'access_suspended':
            return {
                subject: 'Atendimento pausado por falta de pagamento · OdontoBox360',
                headline: 'A clínica está em somente-leitura',
                body: [
                    'A cobrança em aberto passou do prazo e o envio de mensagens foi pausado. O agente parou de responder, e os números de WhatsApp continuam conectados.',
                    /* O que **não** se perde é a parte que acalma, e é
                       verdade: o corte não apaga nada nem desconecta linha. */
                    'Nada foi apagado: conversas, pacientes, agenda e histórico continuam inteiros e exportáveis.',
                    'Pagar restaura tudo na hora, sem reconectar nada.',
                ],
                cta: 'Pagar agora',
                tone: 'urgent',
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

/**
 * A casca saiu daqui para `email/layout.ts`.
 *
 * Ela estava duplicada com os e-mails de autenticação — o comentário antigo
 * dizia isso — e o e-mail de redefinição de senha do Better Auth precisava dela.
 * Duas cópias de 25 linhas de tabela inline divergem na primeira correção feita
 * só em uma.
 */
function render(copy: Copy): string {
    return renderEmail({
        headline: copy.headline,
        body: copy.body,
        cta: { texto: copy.cta, url: PLANS_URL },
        tone: copy.tone,
    })
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
