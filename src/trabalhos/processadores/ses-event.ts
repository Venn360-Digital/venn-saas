import prisma from '@/lib/prisma'
import type { SesEventJob } from '@/lib/queue/definitions'
import { createLogger } from '@/trabalhos/registro'
import {
    avanca,
    lerEventoDoSes,
    pedeSupressao,
    statusDoEvento,
    type EventoDoSes,
} from '@/lib/email/eventos'
import { suprimir } from '@/lib/email/ses'

const log = createLogger('SES-EVENT')

/**
 * Aplica um recibo do SES ao destinatário que o gerou.
 *
 * ## Por que o destinatário é achado pelo `MessageId`, e não pelo endereço
 *
 * O mesmo e-mail pode estar em duas campanhas ao mesmo tempo. Procurar pelo
 * endereço marcaria as duas como abertas quando só uma foi. O `sesMessageId` é
 * gravado no envio e é único por mensagem — é a única chave que não é ambígua.
 *
 * ## O que acontece quando não se acha
 *
 * Nada, e isso é normal: o `Send` costuma chegar antes de a transação do envio
 * ter gravado o `sesMessageId`, e um e-mail de teste (como o de
 * `scripts/testar-ses.ts`) não tem destinatário nenhum no banco. A fila
 * confirma e segue — insistir não faria o registro aparecer.
 */
export async function processSesEvent(payload: SesEventJob): Promise<void> {
    const evento = lerEventoDoSes(payload.corpo)
    if (!evento) {
        // Mensagem de teste do console do SNS, ou um tipo que não publicamos.
        log.info('evento ignorado: não é um recibo conhecido do SES')
        return
    }

    const destinatario = await prisma.broadcastRecipient.findFirst({
        where: { sesMessageId: evento.messageId },
        select: {
            id: true,
            status: true,
            broadcastId: true,
            contactId: true,
            to: true,
            openedAt: true,
            clickedAt: true,
            broadcast: { select: { workspaceId: true } },
        },
    })

    if (!destinatario) {
        /**
         * Sem destinatário de campanha, o e-mail pode ter saído de um **funil**
         * — e aí o workspace vem da passagem, pela tag `funnelRun`.
         *
         * Isto não é refinamento. Antes dele, `talvezSuprimir` recebia
         * `workspaceId` nulo e **pulava** a escrita de `Contact.emailOptOutAt`:
         * um bounce duro num e-mail de funil não tirava ninguém da lista, e o
         * funil continuava mandando para o endereço que quica a cada passo e a
         * cada passagem nova. Medido em homologação — o recibo chegava com
         * "sem destinatário" e nada era gravado.
         *
         * A supressão na conta do SES vale nos dois casos; o que faltava era a
         * coluna por contato, que é a única proteção em pé enquanto a conta
         * está no sandbox.
         */
        const doFunil = evento.funnelRunId
            ? await prisma.funnelRun.findUnique({
                  where: { id: evento.funnelRunId },
                  select: { funnel: { select: { workspaceId: true } } },
              })
            : null

        if (doFunil) {
            log.info(
                `recibo de funil ${evento.messageId} (${evento.tipo}) — passagem ${evento.funnelRunId}`
            )
        } else {
            log.info(`sem destinatário para ${evento.messageId} (${evento.tipo})`)
        }

        await talvezSuprimir(evento, doFunil?.funnel.workspaceId ?? null)
        return
    }

    await aplicar(evento, destinatario)
    await talvezSuprimir(evento, destinatario.broadcast.workspaceId)
}

type DestinatarioDoRecibo = NonNullable<
    Awaited<ReturnType<typeof prisma.broadcastRecipient.findFirst>>
> & {
    openedAt: Date | null
    clickedAt: Date | null
    broadcast: { workspaceId: string }
}

/** Grava o que o evento muda no destinatário e nos contadores da campanha. */
async function aplicar(
    evento: EventoDoSes,
    d: {
        id: string
        status: string
        broadcastId: string
        openedAt: Date | null
        clickedAt: Date | null
    }
): Promise<void> {
    const dados: Record<string, unknown> = {}

    /**
     * Primeira abertura e primeiro clique, não a última.
     *
     * O SES emite um evento por abertura, e quem abre cinco vezes não é cinco
     * pessoas. Sobrescrever perderia justamente o dado que interessa — quando
     * a pessoa reagiu.
     */
    if (evento.tipo === 'Open' && !d.openedAt) dados.openedAt = evento.em
    if (evento.tipo === 'Click' && !d.clickedAt) dados.clickedAt = evento.em

    const novo = statusDoEvento(evento)
    /**
     * O status só sobe.
     *
     * A ordem de entrega do SNS **não é garantida**: um `Delivery` atrasado
     * pode chegar depois de um `Open`, e aplicá-lo rebaixaria o destinatário de
     * "lido" para "entregue". O relatório ficaria pior quanto mais a rede
     * demorasse — um defeito que só aparece sob carga.
     */
    const sobe = novo !== null && avanca(d.status, novo)
    if (sobe) dados.status = novo
    if (evento.motivo && (novo === 'failed' || evento.tipo === 'DeliveryDelay')) {
        dados.error = evento.motivo.slice(0, 500)
    }

    if (Object.keys(dados).length === 0) return

    /**
     * `failedCount` acompanha a transição, e só na ida.
     *
     * Sem o `sobe`, um segundo evento de falha (bounce e reclamação para o
     * mesmo envio acontecem) contaria a mesma falha duas vezes, e a tela
     * mostraria mais falhas do que destinatários.
     */
    const virouFalha = sobe && novo === 'failed'

    await prisma.$transaction([
        prisma.broadcastRecipient.update({ where: { id: d.id }, data: dados }),
        ...(virouFalha
            ? [
                  prisma.broadcast.update({
                      where: { id: d.broadcastId },
                      data: { failedCount: { increment: 1 } },
                  }),
              ]
            : []),
    ])
}

/**
 * Bounce duro e reclamação tiram a pessoa da lista — nos dois lugares.
 *
 * `Contact.emailOptOutAt` protege o contato **naquela unidade**, e a lista de
 * supressão do SES protege o **domínio** contra reenvio por outro caminho:
 * outra lista, outro import, outra unidade da mesma conta. Um sem o outro
 * deixa um buraco.
 *
 * A falha da supressão não derruba o processamento: ela é indisponível
 * enquanto a conta está no sandbox ("bulk actions and SES API calls related to
 * suppression list management are disabled"), e perder o recibo inteiro por
 * causa disso seria pior do que perder a supressão.
 */
async function talvezSuprimir(evento: EventoDoSes, workspaceId: string | null): Promise<void> {
    if (!pedeSupressao(evento)) return

    const motivo = evento.tipo === 'Complaint' ? 'COMPLAINT' : 'BOUNCE'
    let suprimidos = 0

    for (const endereco of evento.destinatarios) {
        if (workspaceId) {
            await prisma.contact.updateMany({
                where: {
                    workspaceId,
                    email: { equals: endereco, mode: 'insensitive' },
                    emailOptOutAt: null,
                },
                data: { emailOptOutAt: evento.em },
            })
        }

        const r = await suprimir(endereco, motivo)
        if (r.ok) suprimidos++
        else log.warn(`supressão de ${endereco} falhou: ${r.error}`)
    }

    /**
     * Conta o que **deu certo**, não o que foi tentado.
     *
     * A primeira versão imprimia `destinatarios.length` logo depois do aviso de
     * falha, então o log dizia "1 endereço(s) suprimido(s)" justamente na linha
     * em que a supressão havia falhado. Quem fosse investigar reenvio para um
     * endereço que deu bounce leria o log, veria a supressão confirmada e
     * procuraria o defeito em outro lugar.
     *
     * Os dois números aparecem quando divergem, porque a diferença é o que
     * interessa: no sandbox ela é o total, e aí o `emailOptOutAt` é a única
     * proteção em pé.
     */
    const total = evento.destinatarios.length
    if (suprimidos === total) {
        log.info(`${evento.tipo}: ${total} endereço(s) suprimido(s) no SES`)
    } else {
        log.warn(
            `${evento.tipo}: ${suprimidos} de ${total} endereço(s) suprimido(s) no SES; ` +
                'o resto está protegido só por emailOptOutAt nesta unidade'
        )
    }
}

export type { DestinatarioDoRecibo }
