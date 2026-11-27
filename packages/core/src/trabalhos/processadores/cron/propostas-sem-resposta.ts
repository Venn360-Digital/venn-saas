import prisma from '@venn/db/cliente'

import { createLogger } from '../../registro'
import { ROTULO_DO_TIPO, ehTipoDeDocumento } from '../../../lib/propostas/estados'

const log = createLogger('CRON:PROPOSTAS_SEM_RESPOSTA')

/**
 * A proposta que foi enviada e ninguém respondeu — avisa **o vendedor**.
 *
 * ## Por que cron, e não o `MotorDoFunil`
 *
 * O plano deste módulo previa Workflow: uma instância por proposta, dormindo
 * com `step.sleep` até o dia do follow-up. Troquei por cron depois de pensar
 * melhor, e a razão é decisiva:
 *
 * **Um Workflow dormindo três dias teria de reconferir o estado ao acordar de
 * todo modo** — a proposta pode ter sido aceita, recusada, revogada ou
 * substituída por uma v2 nesse meio. Ou seja, ele não evita a consulta; só
 * adianta o agendamento dela. E custaria um binding novo nos três
 * `cloudflare.config.ts` mais provisionamento, ou enfiar o domínio de proposta
 * dentro do motor de **funis de marketing**, que tem os seus próprios passos.
 *
 * Em troca, esta rotina pega carona num gatilho que já existe (o mesmo da poda
 * de retenção, onde a expiração de proposta também mora) e a precisão de um dia
 * é suficiente: "ele não respondeu em três dias" não precisa de precisão de
 * hora.
 *
 * ## Avisa o VENDEDOR, nunca o cliente
 *
 * Nada é enviado ao cliente por esta rotina. Dois motivos, e qualquer um basta:
 * disparo frio está bloqueado por construção neste projeto, e mandar cobrança
 * automática em nome da clínica é texto escrito por nós prometendo o que não
 * sabemos — a mesma regra que impede os passos de funil de trazerem texto
 * pronto. Quem decide cobrar é a pessoa; esta rotina garante que ela se lembre.
 *
 * ## Não duplica por construção
 *
 * `NotificationLog` tem `@@unique([workspaceId, kind, scope])`, e o `scope`
 * carrega a proposta **e o marco**. A reivindicação vem primeiro: se o `create`
 * falhar por unique, já se avisou e a rotina segue. É o mesmo padrão de
 * `lib/email/billing.ts`, e é o que dispensa uma coluna de "já cobrei".
 */

/**
 * Os marcos, em dias desde o PRIMEIRO envio.
 *
 * Dois, e não cinco: o terceiro aviso sobre a mesma proposta deixa de ser
 * lembrete e passa a ser ruído — e a pessoa aprende a ignorar a sineta, o que
 * custa os avisos que importam.
 *
 * Três dias é o prazo em que a falta de resposta ainda é notícia; sete é o
 * último em que a retomada costuma funcionar.
 */
const MARCOS_EM_DIAS = [3, 7] as const

/** Teto por varredura, para a primeira execução não despejar cem avisos. */
const MAX_POR_VARREDURA = 50

const DIA_EM_MS = 86_400_000

export async function runPropostasSemResposta(): Promise<void> {
    const agora = Date.now()
    let avisos = 0

    for (const marco of MARCOS_EM_DIAS) {
        /**
         * A janela é de UM dia, não "há mais de N dias".
         *
         * Com `lt: agora - 3 dias` a proposta de dez dias casaria com o marco de
         * três todos os dias — e só o `NotificationLog` a seguraria. Funcionaria,
         * e faria a rotina reler o mesmo registro para sempre. A janela fecha
         * isso na consulta: cada proposta cruza cada marco uma vez.
         */
        const fim = new Date(agora - marco * DIA_EM_MS)
        const inicio = new Date(agora - (marco + 1) * DIA_EM_MS)

        const candidatas = await prisma.proposalShare.findMany({
            where: {
                sharedAt: { gte: inicio, lt: fim },
                // Sem desfecho: aceito não se cobra, revogado não existe mais.
                acceptedAt: null,
                revokedAt: null,
                // O link ainda abre. Cobrar resposta de um link que não abre
                // mandaria a pessoa pedir ao cliente que clicasse em nada.
                expiresAt: { gt: new Date(agora) },
                revision: {
                    // Só a revisão VIGENTE, e só se ainda está `enviada`: uma v2
                    // criada nesse meio significa que a conversa seguiu, e
                    // `aceita`/`recusada`/`expirada` já têm desfecho.
                    status: 'enviada',
                    currentFor: { deletedAt: null },
                },
            },
            take: MAX_POR_VARREDURA,
            select: {
                id: true,
                sharedAt: true,
                _count: { select: { views: true } },
                revision: {
                    select: {
                        validUntil: true,
                        currentFor: {
                            select: {
                                id: true,
                                kind: true,
                                number: true,
                                workspaceId: true,
                                userId: true,
                                title: true,
                                deal: {
                                    select: {
                                        userId: true,
                                        status: true,
                                        contact: { select: { name: true } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        })

        for (const link of candidatas) {
            const proposta = link.revision.currentFor
            if (!proposta) continue

            // Negócio já fechado não precisa de cobrança de proposta: o
            // desfecho veio por outro caminho.
            if (proposta.deal.status !== 'open') continue

            /**
             * O prazo comercial venceu: quem cuida disso é
             * `propostas-expiradas`, e dois avisos sobre o mesmo fato seriam um
             * a mais.
             *
             * O prazo é da REVISÃO, não da proposta — ela não tem prazo
             * próprio, e a v2 pode ter outro que a v1.
             */
            if (link.revision.validUntil && link.revision.validUntil.getTime() < agora) {
                continue
            }

            const destinatario = proposta.deal.userId ?? proposta.userId
            const scope = `proposta:${proposta.id}:${marco}d`

            /**
             * Reivindica ANTES de avisar.
             *
             * Se o `create` falhar por unique, já se avisou deste marco. Avisar
             * primeiro e registrar depois deixaria a janela em que a rotina cai
             * no meio e a pessoa recebe o mesmo aviso amanhã.
             */
            try {
                await prisma.notificationLog.create({
                    data: {
                        workspaceId: proposta.workspaceId,
                        kind: 'proposta_sem_resposta',
                        scope,
                        sentTo: destinatario ?? 'unidade',
                    },
                })
            } catch {
                continue
            }

            const rotulo = ROTULO_DO_TIPO[ehTipoDeDocumento(proposta.kind) ? proposta.kind : 'proposta']
            const quem = proposta.deal.contact?.name
            const aberturas = link._count.views

            /**
             * O texto muda com as aberturas, e é aqui que este módulo paga o
             * que custou.
             *
             * Zero abertura **não** é "ele não gostou" — é "ele não abriu", e a
             * ação seguinte é outra: confirmar se o link chegou, não renegociar
             * preço. Nenhum CRM que manda PDF anexo sabe a diferença.
             */
            const corpo =
                aberturas === 0
                    ? `${quem ?? 'O cliente'} não abriu ${rotulo.toLowerCase()} ${proposta.number} em ${marco} dias. Confirme se o link chegou.`
                    : `${quem ?? 'O cliente'} abriu ${rotulo.toLowerCase()} ${proposta.number} ${aberturas} ${aberturas === 1 ? 'vez' : 'vezes'} e não respondeu em ${marco} dias.`

            try {
                await prisma.notification.create({
                    data: {
                        workspaceId: proposta.workspaceId,
                        userId: destinatario,
                        kind: 'follow_up',
                        title: `${rotulo} ${proposta.number} sem resposta`,
                        body: corpo,
                        link: `/vendas/propostas/${proposta.id}`,
                    },
                })
                avisos++
            } catch (erro) {
                /**
                 * Devolve a reivindicação: um aviso registrado e não entregue é
                 * pior que um aviso atrasado, porque nunca mais seria tentado.
                 * Mesma disciplina de `lib/email/billing.ts`.
                 */
                await prisma.notificationLog
                    .delete({
                        where: {
                            workspaceId_kind_scope: {
                                workspaceId: proposta.workspaceId,
                                kind: 'proposta_sem_resposta',
                                scope,
                            },
                        },
                    })
                    .catch(() => {})
                log.error(`falhou ao avisar sobre a proposta ${proposta.id}: ${String(erro)}`)
            }
        }
    }

    if (avisos > 0) log.info(`${avisos} aviso(s) de proposta sem resposta`)
}
