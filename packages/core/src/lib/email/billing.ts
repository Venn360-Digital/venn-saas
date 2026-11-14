import prisma from '@venn/db/cliente'
import { BRAND } from '../../marca'
import { sendEmail } from './send'
import { CAMINHOS, renderEmail, type PassoDoEmail } from './layout'

/**
 * Funções, e não constantes — porque a marca vem de um registro.
 *
 * Como `const` de nível de módulo, as três chamariam `BRAND()` no instante do
 * import, antes de `registrarBrand()` se o grafo mudar de ordem, e congelariam
 * o valor. Este módulo é carregado por cron (os avisos de fim de avaliação e
 * de crédito), onde não há requisição para reavaliá-lo.
 */
/** clínica · empresa · agência. A casca nunca escreve a palavra literal. */
const ORG = () => BRAND().vocabulario.organizacao
/** paciente · cliente. O outro eixo do vocabulário — quem é atendido. */
const PESSOAS = () => BRAND().vocabulario.pessoas
const PESSOA = () => BRAND().vocabulario.pessoa

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
    /** Pagamento recebido com sucesso. */
    | 'payment_confirmed'
    /** Bem-vindo ao novo workspace. */
    | 'welcome'

// O host vem da MARCA, não escrito à mão: um literal aqui é o host de um
// produto dentro do código de outro, e a auditoria de isolamento recusa —
// com razão, porque o clone herdaria o endereço errado em silêncio.
/** Preguiçoso: ver a nota acima. */
function appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? `https://${BRAND().appHost}`
}
/**
 * Função, e não constante — por consequência de `appUrl()` ter virado função.
 *
 * Era `${APP_URL}` com `APP_URL` sendo `const` de módulo que lia `BRAND.appHost`
 * estático: funcionava. Ao trocar a leitura estática pelo registro, esta linha
 * passou a chamar `BRAND()` na avaliação do módulo — e foi ela que derrubou o
 * deploy de preview com `MarcaNaoRegistradaError` no startup do Worker, depois
 * de o build compilar inteiro. `scripts/check-marca-tardia.ts` existe por causa
 * dela.
 */
function plansUrl(): string {
    return `${appUrl()}/gerenciamento/conta?tab=plano`
}

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
    ilustracao?: 'conversa' | 'cobranca'
    passos?: PassoDoEmail[]
    sobOBotao?: string
    /** Fecho acima do rodapé, separado por um fio. */
    rodape?: string
    /** Por que esta pessoa recebe isto — muda por tipo, e o rodapé a imprime. */
    porque?: string
}

/**
 * A fatura em aberto da conta, se houver uma com link.
 *
 * O espelho da cobrança (`Invoice`) é mantido pelo webhook do Asaas, então aqui
 * é leitura de dado que já existe — nenhuma chamada à API deles no caminho de um
 * e-mail. A mais recente por vencimento, entre as que não foram pagas.
 */
async function faturaEmAberto(accountId: string | undefined): Promise<string | null> {
    if (!accountId) return null
    const fatura = await prisma.invoice.findFirst({
        where: { accountId, paidAt: null, invoiceUrl: { not: null } },
        orderBy: { dueDate: 'desc' },
        select: { invoiceUrl: true },
    })
    return fatura?.invoiceUrl ?? null
}

/**
 * Para onde o botão vai — **por tipo de aviso**, e não um destino para todos.
 *
 * `render` mandava os dez e-mails para `plansUrl()`. O rótulo mudava e o link
 * não: "Ver a fatura" abria a guia de assinatura, "Pagar agora" idem, e o
 * "Acessar dashboard" das boas-vindas levava o cliente novo para a tela de
 * trocar de plano. Botão que não vai onde o texto promete é link quebrado, mesmo
 * respondendo 200 — e era a origem da queixa do Andre em 2026-11-05.
 *
 * A fatura do Asaas chega em `context.invoiceUrl`, gravada na nossa tabela
 * `Invoice`. Faltando ela — webhook antigo, cobrança sem URL —, cai na
 * assinatura, que é o lugar onde a pessoa acha a fatura por conta própria. Cair
 * num lugar útil é diferente de prometer um e entregar outro.
 */
async function ctaUrlFor(
    kind: BillingEmailKind,
    accountId: string | undefined,
    context: Record<string, unknown>
): Promise<string> {
    const fatura = typeof context.invoiceUrl === 'string' ? context.invoiceUrl : null

    switch (kind) {
        case 'payment_overdue':
        case 'access_suspended':
        case 'payment_confirmed':
            /**
             * Quem avisa pelo webhook já tem a fatura em mão. Quem avisa pela
             * varredura de corte (`cron/billing-dunning`) não tem — ali não há
             * evento nenhum, só uma data que passou —, então a fatura é buscada
             * no espelho que o webhook mantém.
             */
            return fatura ?? (await faturaEmAberto(accountId)) ?? plansUrl()
        case 'welcome':
            return `${appUrl()}/dashboard`
        default:
            // Avaliação, retenção e crédito: a decisão é contratar ou trocar de
            // plano, e as três acontecem na guia de assinatura.
            return plansUrl()
    }
}

function copyFor(
    kind: BillingEmailKind,
    context: Record<string, unknown> = {}
): Copy {
    switch (kind) {
        case 'trial_day_5':
            return {
                subject: `Faltam 2 dias de avaliação · ${BRAND().name}`,
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
                subject: `Cobrança vencida · ${BRAND().name}`,
                headline: 'Sua mensalidade está em aberto',
                body: [
                    `A cobrança de ${context.valor as string} venceu em ${context.vencimento as string}.`,
                    /* A carência é o que esta mensagem existe para contar. Um
                       aviso de atraso sem prazo vira susto; com prazo, vira
                       instrução — e o cliente sabe que ainda dá tempo. */
                    `Você tem até <strong style="color:#0b1f3b;">${context.ate as string}</strong> para pagar sem interrupção. Depois dessa data a ${ORG()} fica em somente-leitura: as mensagens continuam chegando e o histórico fica inteiro, mas o envio e o agente param.`,
                    'Se já pagou nas últimas horas, pode ignorar — a confirmação do banco leva alguns minutos.',
                ],
                cta: 'Ver a fatura e pagar',
                sobOBotao: 'Abre a fatura no Asaas, com Pix, boleto e cartão.',
                porque: `Você recebe este e-mail porque é o responsável financeiro da conta. Avisos de cobrança não podem ser desligados enquanto a assinatura estiver ativa.`,
                ilustracao: 'cobranca',
                tone: 'urgent',
            }
        case 'access_suspended':
            return {
                subject: `Atendimento pausado por falta de pagamento · ${BRAND().name}`,
                headline: `A ${ORG()} está em somente-leitura`,
                body: [
                    'A cobrança em aberto passou do prazo e o envio de mensagens foi pausado. O agente parou de responder, e os números de WhatsApp continuam conectados.',
                    /* O que **não** se perde é a parte que acalma, e é
                       verdade: o corte não apaga nada nem desconecta linha. */
                    `Nada foi apagado: conversas, ${PESSOAS()}, agenda e histórico continuam inteiros e exportáveis.`,
                    'Pagar restaura tudo na hora, sem reconectar nada.',
                ],
                cta: 'Pagar agora',
                porque: 'Você recebe este e-mail porque é o responsável financeiro da conta.',
                ilustracao: 'cobranca',
                tone: 'urgent',
            }
        case 'trial_day_6':
            return {
                subject: `Sua avaliação termina amanhã · ${BRAND().name}`,
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
                subject: `Avaliação encerrada · ${BRAND().name}`,
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
                subject: `Seus dados serão removidos em 60 dias · ${BRAND().name}`,
                headline: 'Seus dados ainda estão aqui',
                body: [
                    `Como a assinatura não foi contratada, os dados desta ${ORG()} serão removidos em ${formatDate(context.deleteAt as Date)}.`,
                    'Até lá nada muda: tudo continua acessível para consulta e exportação, e contratar um plano a qualquer momento restabelece o atendimento sem perda nenhuma.',
                    `Se preferir levar seus dados, a exportação está disponível nas telas de ${PESSOAS()} e negócios.`,
                ],
                cta: 'Manter minha conta ativa',
                tone: 'neutral',
            }
        case 'retention_7':
            return {
                subject: `Últimos 7 dias antes da remoção · ${BRAND().name}`,
                headline: 'Seus dados serão removidos em 7 dias',
                body: [
                    `A remoção está marcada para ${formatDate(context.deleteAt as Date)} e é definitiva.`,
                    `Se quiser manter o histórico, contrate um plano antes dessa data — ou exporte seus ${PESSOAS()} e negócios enquanto o acesso continua aberto.`,
                ],
                cta: 'Contratar um plano',
                tone: 'urgent',
            }
        case 'credits_80': {
            const used = Number(context.creditsUsed ?? 0)
            const total = Number(context.credits ?? 0)
            return {
                subject: `Seus créditos de IA estão acabando · ${BRAND().name}`,
                headline: '80% dos créditos utilizados',
                body: [
                    `Você usou ${used.toLocaleString('pt-BR')} dos ${total.toLocaleString('pt-BR')} créditos do período.`,
                    `Quando acabarem, o agente para de responder automaticamente e avisa o ${PESSOA()} de que o atendimento continua em instantes. Sua equipe segue respondendo normalmente.`,
                ],
                cta: 'Ver os créditos',
                sobOBotao: 'Dá para comprar um pacote avulso sem trocar de plano.',
                porque: 'Você recebe este aviso uma vez por período. Ele volta quando o consumo recomeçar.',
                tone: 'neutral',
            }
        }
        case 'welcome': {
            const nome = (context.workspaceName as string) || `sua ${ORG()}`
            return {
                subject: `A sua ${ORG()} já está no ar · ${BRAND().name}`,
                headline: `A sua ${ORG()} já está no ar`,
                body: [
                    `O workspace <strong style="color:#0b1f3b;">${nome}</strong> foi criado.`,
                    'Para o agente atender de verdade, três coisas faltam — e dá para fazer as três hoje:',
                ],
                /* Os caminhos de menu são reais e conferidos. O texto anterior
                   dizia "configure seus números, adicione sua equipe e comece a
                   atender" numa frase só, sem dizer onde fica nada disso. */
                passos: [
                    {
                        titulo: 'Conectar o WhatsApp',
                        corpo: 'Em <strong style="color:#0b1f3b;">Atendimento e IA &rarr; Agentes de IA &rarr; Integrações</strong>, leia o QR Code com o celular. Leva um minuto.',
                    },
                    {
                        titulo: 'Ensinar o agente',
                        corpo: 'Em <strong style="color:#0b1f3b;">Treinamento</strong> há oito documentos a preencher — endereço e horário, serviços e preços, o que o agente não faz. Sem eles, ele responde “não sei informar”.',
                    },
                    {
                        titulo: 'Chamar a sua equipe',
                        corpo: `Em <strong style="color:#0b1f3b;">Gerenciamento &rarr; Conta &rarr; Usuários</strong>, convide quem atende na ${ORG()}.`,
                    },
                ],
                cta: 'Entrar no painel',
                sobOBotao: `Preferindo um passo a passo escrito, o <a href="${CAMINHOS.ajuda}" style="color:#0a5566;">roteiro de preenchimento</a> fica na central de ajuda.`,
                rodape: 'Sua avaliação de <strong style="color:#0b1f3b;">7 dias</strong> começou hoje. Nada é cobrado até você escolher um plano, e nenhum cartão foi pedido.',
                porque: `Você recebe este e-mail porque criou a conta da ${ORG()} no ${BRAND().name}.`,
                ilustracao: 'conversa',
                tone: 'neutral',
            }
        }
        case 'payment_confirmed':
            return {
                subject: `Pagamento recebido · ${BRAND().name}`,
                headline: 'Pagamento recebido',
                body: [
                    `Confirmamos o recebimento de ${context.valor as string}.`,
                    `Sua próxima cobrança está marcada para ${context.proximaCobranca as string}.`,
                    `O atendimento segue sem interrupção — obrigado por confiar no ${BRAND().name}.`,
                ],
                cta: 'Ver o comprovante',
                porque: 'Você recebe este e-mail porque é o responsável financeiro da conta.',
                tone: 'neutral',
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
function render(copy: Copy, url: string): string {
    return renderEmail({
        headline: copy.headline,
        body: copy.body,
        cta: { texto: copy.cta, url },
        tone: copy.tone,
        ilustracao: copy.ilustracao,
        passos: copy.passos,
        sobOBotao: copy.sobOBotao,
        rodape: copy.rodape,
        porque: copy.porque,
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
    const result = await sendEmail({
        to,
        subject: copy.subject,
        html: render(copy, await ctaUrlFor(kind, accountId, context)),
    })

    if (!result.ok) {
        // Release the claim so the next run can try again — a warning that was
        // logged but never delivered is worse than one sent late.
        await prisma.notificationLog
            .delete({ where: { workspaceId_kind_scope: { workspaceId, kind, scope } } })
            .catch(() => {})
        console.error('[BILLING_EMAIL]', kind, workspaceId, result.error)
    }
}
