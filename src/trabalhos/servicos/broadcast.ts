import prisma from '@/lib/prisma'
import { QUEUE } from '@/lib/queue/definitions'
import { enfileirar } from '@/trabalhos/filas'
import { resolverLinhaOficial } from '@/lib/marketing/lines'
import {
    prepararEnvioDeTemplate,
    corpoRenderizado,
    type BroadcastVariables,
} from '@/lib/marketing/templates'
import { normalizeNumber } from '@/lib/whatsapp/types'
import { createLogger } from '@/trabalhos/registro'
import { enviarPorSes } from '@/lib/email/ses'
import {
    campanhaEmTexto,
    lerBlocos,
    primeiroNome,
    renderCampanha,
    type CamposDaMesclagem,
} from '@/lib/email/blocos'
import { urlDeDescadastro } from '@/lib/marketing/descadastro'
import { whereDeDestinatarios } from '@/lib/marketing/lists'
import { BRAND } from '@/config/brand'

const log = createLogger('BROADCAST')

/**
 * O disparo de campanha — **dois canais, um motor**.
 *
 * O que é caro aqui não tem nada de canal: congelar destinatários, expandir em
 * ritmo, não reenviar a quem já recebeu, fechar a campanha quando o último sai.
 * Por isso WhatsApp e e-mail dividem `fanOut`, `marcarFalha` e `talvezConcluir`,
 * e divergem só em `enviarDestinatario`, que despacha por `broadcast.channel`.
 *
 * A alternativa — um serviço por canal — duplicaria este arquivo, e a segunda
 * cópia divergiria na primeira correção feita só numa delas.
 */

/** O endereço base do app, para o link de descadastro. */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? `https://${BRAND.appHost}`

/**
 * Congela os destinatários de uma campanha a partir das listas que ela mira.
 *
 * Contato distinto, com o endereço do canal, não em opt-out **daquele canal**.
 * Idempotente: o índice único `(broadcastId, contactId)` e o `skipDuplicates`
 * deixam repopular sem duplicar. Devolve quantos entraram — vira o `totalCount`.
 *
 * Roda uma vez, no disparo. Lista grande cabe em memória aqui (ids e endereços);
 * se algum dia não couber, isto vira paginação — mas não antes.
 */
export async function congelarDestinatarios(broadcastId: string): Promise<number> {
    const broadcast = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: { channel: true, workspaceId: true, lists: { select: { listId: true } } },
    })
    if (!broadcast) throw new Error(`campanha ${broadcastId} não encontrada`)

    const listIds = broadcast.lists.map((l) => l.listId)
    if (listIds.length === 0) return 0

    const porEmail = broadcast.channel === 'email'

    /**
     * O recorte muda com o canal, e os dois eixos mudam juntos.
     *
     * **Endereço:** contato sem telefone não recebe WhatsApp, e contato sem
     * e-mail não recebe e-mail. Deixar passar para o fan-out descartar lá
     * faria `totalCount` mentir sobre o alcance — a tela mostraria 2.000
     * destinatários e 1.300 "pulados" sem explicação.
     *
     * **Opt-out:** são colunas separadas de propósito. Quem se descadastrou da
     * newsletter não pediu para o atendimento por WhatsApp parar, e quem
     * respondeu "pare" no WhatsApp não pediu para sair da newsletter. Um campo
     * só para os dois calaria o canal onde a clínica de fato atende.
     */
    const membros = await prisma.contact.findMany({
        // O MESMO predicado que a rota de disparo usa para estimar o alcance e
        // conferir o teto do plano. Escritos separados, eles divergiriam — e o
        // sintoma seria o plano aprovado contra um número e a campanha saindo
        // com outro.
        where: whereDeDestinatarios(
            broadcast.workspaceId,
            porEmail ? 'email' : 'whatsapp',
            listIds
        ),
        select: { id: true, phone: true, email: true },
    })

    if (membros.length > 0) {
        await prisma.broadcastRecipient.createMany({
            data: membros.map((c) => ({
                broadcastId,
                contactId: c.id,
                to: porEmail ? (c.email ?? '').trim().toLowerCase() : normalizeNumber(c.phone ?? ''),
            })),
            skipDuplicates: true,
        })
    }

    const total = await prisma.broadcastRecipient.count({ where: { broadcastId } })
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { totalCount: total } })
    return total
}

/**
 * Enfileira o disparo: marca a campanha em progresso e manda o fan-out para a
 * fila. Chamado pela rota `/send` (imediato) ou pelo cron (agendado).
 */
export async function iniciarDisparo(broadcastId: string): Promise<void> {
    await prisma.broadcast.update({
        where: { id: broadcastId },
        data: { status: 'running', startedAt: new Date() },
    })
    await enfileirar(QUEUE.BROADCAST, { phase: 'fanout', broadcastId })
}

/** Teto de atraso de uma mensagem da fila da Cloudflare (~12h). */
const ATRASO_MAX_S = 12 * 60 * 60

/**
 * Expande a campanha nos envios pendentes, escalonando pelo ritmo.
 *
 * O i-ésimo pendente sai em `ceil(i * 60 / throttlePerMin)` segundos — o que dá
 * exatamente `throttlePerMin` por minuto. Além do teto de atraso da fila, o
 * disparo fica no limite (register DUVIDAS-B2: lista enorme a ritmo baixo
 * passaria de 12h; aqui os excedentes saem no teto, sem perder ninguém).
 *
 * O ritmo serve aos dois canais, por motivos diferentes: no WhatsApp é o tier de
 * throughput da WABA; no e-mail é a cota diária do SES e a reputação do domínio
 * do cliente, que uma rajada de dois mil e-mails num domínio novo derrubaria.
 */
export async function fanOut(broadcastId: string): Promise<void> {
    const broadcast = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: { throttlePerMin: true, status: true },
    })
    if (!broadcast) throw new Error(`campanha ${broadcastId} não encontrada`)
    if (broadcast.status === 'canceled') {
        log.info(`campanha ${broadcastId} cancelada; fan-out abortado`)
        return
    }

    const pendentes = await prisma.broadcastRecipient.findMany({
        where: { broadcastId, status: 'pending' },
        select: { id: true },
    })

    const porMin = Math.max(1, broadcast.throttlePerMin)
    let i = 0
    for (const r of pendentes) {
        const atraso = Math.min(Math.ceil((i * 60) / porMin), ATRASO_MAX_S)
        await enfileirar(
            QUEUE.BROADCAST,
            { phase: 'send', broadcastId, recipientId: r.id },
            atraso > 0 ? { atrasoSegundos: atraso } : undefined
        )
        i++
    }
    log.info(`campanha ${broadcastId}: ${i} envio(s) enfileirado(s) a ${porMin}/min`)
}

/**
 * Entrega a um destinatário, pelo canal da campanha.
 *
 * Idempotente: só age sobre destinatário `pending` (o id de dedup da fila é o
 * `recipientId`, então uma reentrega não reenvia).
 */
export async function enviarDestinatario(broadcastId: string, recipientId: string): Promise<void> {
    const recipient = await carregarDestinatario(recipientId)
    if (!recipient) return
    if (recipient.status !== 'pending') return // já tratado — reentrega
    const { broadcast } = recipient
    if (broadcast.status === 'canceled') return

    if (broadcast.channel === 'email') {
        await enviarPorEmail(recipient, recipientId, broadcastId)
    } else {
        await enviarPorWhatsApp(recipient, recipientId, broadcastId)
    }

    await talvezConcluir(broadcastId)
}

/**
 * Carrega o destinatario com tudo que os dois canais podem precisar.
 *
 * Uma consulta so, e nao uma por canal: o `include` extra custa dois joins que
 * voltam nulos no canal que nao os usa, e duas consultas custariam duas idas ao
 * Neon -- onde cada ida e ~110 ms de handshake.
 *
 * Existe como funcao, e nao inline, para o **tipo** sair dela: derivar com
 * `Awaited<ReturnType<...>>` nao depende de qual dos dois clientes gerados
 * (nodejs ou workerd) esta sendo compilado.
 */
function carregarDestinatario(recipientId: string) {
    return prisma.broadcastRecipient.findUnique({
        where: { id: recipientId },
        include: {
            broadcast: { include: { template: true, emailTemplate: true, sender: true } },
            contact: { select: { name: true } },
        },
    })
}

/** O que `enviarDestinatario` carregou do banco, para os dois caminhos de canal. */
type DestinatarioCarregado = NonNullable<Awaited<ReturnType<typeof carregarDestinatario>>>

// ──────────────────────────────── E-mail ────────────────────────────────

/**
 * Entrega um e-mail de campanha pelo SES.
 *
 * Não grava `Message` nem abre conversa — **e-mail não é canal de atendimento
 * aqui**. A resposta do contato vai para o `Reply-To` da clínica, fora do
 * produto; trazer e-mail para Conversas é feature própria, não efeito colateral
 * de uma campanha.
 *
 * O recibo (entrega, abertura, clique, reclamação) chega depois, pelo webhook do
 * SES, e encontra esta linha pelo `sesMessageId`.
 */
async function enviarPorEmail(
    recipient: DestinatarioCarregado,
    recipientId: string,
    broadcastId: string
): Promise<void> {
    const { broadcast } = recipient
    const { sender, emailTemplate } = broadcast

    if (!sender || sender.status !== 'verified') {
        await marcarFalha(recipientId, broadcastId, 'Remetente de e-mail não verificado')
        return
    }
    if (!emailTemplate) {
        await marcarFalha(recipientId, broadcastId, 'Template de e-mail ausente')
        return
    }

    const assunto = broadcast.subject ?? emailTemplate.subject
    if (!assunto) {
        await marcarFalha(recipientId, broadcastId, 'Campanha sem assunto')
        return
    }

    const campos: CamposDaMesclagem = {
        nome: primeiroNome(recipient.contact.name),
        nomeCompleto: recipient.contact.name,
        unidade: sender.fromName,
    }

    try {
        /**
         * O link de descadastro é por contato, e aponta para o **nosso** host.
         *
         * Não para o domínio do cliente: somos nós que servimos a rota e
         * gravamos o opt-out. O domínio dele aparece no remetente, que é o que
         * importa para quem lê.
         */
        const descadastroUrl = await urlDeDescadastro(
            APP_URL,
            broadcast.workspaceId,
            recipient.contactId
        )

        const casca = {
            blocos: lerBlocos(emailTemplate.blocks),
            campos,
            assinatura: sender.fromName,
            descadastroUrl,
            preheader: broadcast.preheader ?? emailTemplate.preheader ?? undefined,
        }

        const resultado = await enviarPorSes({
            de: `${sender.fromLocal}@${sender.domain}`,
            nomeDoRemetente: sender.fromName,
            responderPara: sender.replyTo,
            para: recipient.to,
            assunto,
            html: renderCampanha(casca),
            texto: campanhaEmTexto(casca),
            configurationSet: sender.configurationSetName ?? undefined,
            descadastroUrl,
            // Só ids: o SES aceita `[A-Za-z0-9_-]` em tag, e nome de campanha
            // tem espaço e acento.
            tags: { broadcast: broadcastId, recipient: recipientId },
        })

        if (!resultado.ok) {
            /**
             * Erro definitivo vira `failed`; o resto **lança**, para a fila
             * tentar de novo.
             *
             * A distinção importa: endereço inválido não melhora na segunda
             * tentativa, mas `Throttling` e 5xx melhoram. Marcar tudo como
             * falha descartaria envio que sairia; lançar tudo deixaria a fila
             * insistindo num endereço que nunca vai existir.
             */
            if (resultado.definitivo) {
                await marcarFalha(recipientId, broadcastId, resultado.error ?? 'falha no SES')
                return
            }
            throw new Error(resultado.error ?? 'falha no SES')
        }

        await prisma.$transaction([
            prisma.broadcastRecipient.update({
                where: { id: recipientId },
                data: {
                    status: 'sent',
                    sesMessageId: resultado.messageId ?? null,
                    error: null,
                },
            }),
            prisma.broadcast.update({
                where: { id: broadcastId },
                data: { sentCount: { increment: 1 } },
            }),
        ])
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        await marcarFalha(recipientId, broadcastId, msg.slice(0, 500))
    }
}

// ─────────────────────────────── WhatsApp ───────────────────────────────

/**
 * Entrega o template a um destinatário pelo WhatsApp oficial.
 *
 * Grava a mensagem na conversa do contato naquela linha — abrindo uma se não
 * houver aberta — para a clínica **ler** o que saiu e a resposta do paciente
 * cair no mesmo fio.
 */
async function enviarPorWhatsApp(
    recipient: DestinatarioCarregado,
    recipientId: string,
    broadcastId: string
): Promise<void> {
    const { broadcast } = recipient

    if (!broadcast.integrationId) {
        await marcarFalha(recipientId, broadcastId, 'Campanha sem linha de envio')
        return
    }
    if (!broadcast.template) {
        await marcarFalha(recipientId, broadcastId, 'Template aprovado ausente')
        return
    }

    const linha = await resolverLinhaOficial(broadcast.workspaceId, broadcast.integrationId)
    if (!linha) {
        await marcarFalha(recipientId, broadcastId, 'Linha oficial indisponível')
        return
    }

    const vars = (broadcast.variables ?? {}) as BroadcastVariables
    const template = broadcast.template

    try {
        const conversationId = await resolverConversaDeBroadcast(
            broadcast.workspaceId,
            recipient.contactId,
            linha.integration.agentId,
            broadcast.integrationId
        )

        const message = await prisma.message.create({
            data: {
                conversationId,
                direction: 'outbound',
                content: corpoRenderizado(template.components, vars) || `[${template.metaName}]`,
                contentType: 'text',
                sentBy: 'broadcast',
                status: 'pending',
            },
            select: { id: true },
        })

        const envio = prepararEnvioDeTemplate(
            {
                metaName: template.metaName,
                language: template.language,
                components: template.components,
            },
            vars
        )
        const { externalId } = await linha.provider.sendTemplate(
            linha.credentials,
            recipient.to,
            envio
        )

        await prisma.$transaction([
            prisma.message.update({
                where: { id: message.id },
                data: { status: 'sent', externalId: externalId ?? null },
            }),
            prisma.broadcastRecipient.update({
                where: { id: recipientId },
                data: { status: 'sent', messageId: message.id, error: null },
            }),
            prisma.broadcast.update({
                where: { id: broadcastId },
                data: { sentCount: { increment: 1 } },
            }),
        ])
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        await marcarFalha(recipientId, broadcastId, msg.slice(0, 500))
    }
}

// ──────────────────────────────── Comum ────────────────────────────────

async function marcarFalha(
    recipientId: string,
    broadcastId: string,
    error: string
): Promise<void> {
    await prisma.$transaction([
        prisma.broadcastRecipient.update({
            where: { id: recipientId },
            data: { status: 'failed', error },
        }),
        prisma.broadcast.update({
            where: { id: broadcastId },
            data: { failedCount: { increment: 1 } },
        }),
    ])
}

/** Fecha a campanha quando não resta nenhum destinatário pendente. */
async function talvezConcluir(broadcastId: string): Promise<void> {
    const pendentes = await prisma.broadcastRecipient.count({
        where: { broadcastId, status: 'pending' },
    })
    if (pendentes > 0) return

    const atual = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: { status: true, failedCount: true, sentCount: true },
    })
    if (!atual || atual.status !== 'running') return

    // Falhou por inteiro vira "failed"; qualquer envio bem-sucedido é "done".
    const status = atual.sentCount === 0 && atual.failedCount > 0 ? 'failed' : 'done'
    await prisma.broadcast.update({
        where: { id: broadcastId },
        data: { status, finishedAt: new Date() },
    })
    log.info(`campanha ${broadcastId} concluída como "${status}"`)
}

/**
 * Acha a conversa aberta do contato naquela linha, ou cria uma.
 *
 * **Não reabre conversa arquivada** (decisão em DUVIDAS-B2 item 4): reabrir em
 * massa poluiria "Em espera". Uma resposta posterior do paciente cai no fluxo
 * normal de inbound, que adota/reabre pela regra de lá.
 */
async function resolverConversaDeBroadcast(
    workspaceId: string,
    contactId: string,
    agentId: string,
    integrationId: string
): Promise<string> {
    const aberta = await prisma.conversation.findFirst({
        where: { workspaceId, contactId, integrationId, status: { not: 'closed' } },
        select: { id: true },
    })
    if (aberta) return aberta.id

    const criada = await prisma.conversation.create({
        data: {
            workspaceId,
            contactId,
            agentId,
            integrationId,
            channel: 'whatsapp',
            status: 'active',
        },
        select: { id: true },
    })
    return criada.id
}
