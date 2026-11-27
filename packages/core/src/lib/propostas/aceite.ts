import 'server-only'

import prisma from '@venn/db/cliente'

import { registrarEventoDoDocumento } from './conversa'
import { ROTULO_DO_TIPO, ehTipoDeDocumento } from './estados'
import { valorParaOFunil } from './funil'

/**
 * O que acontece quando o cliente aceita — a cadeia inteira, numa transação.
 *
 * ## Por que tudo junto
 *
 * Seis coisas acontecem no aceite, e nenhuma faz sentido sozinha:
 *
 *   1. o carimbo com a trilha (nome, IP, user-agent, hash do conteúdo)
 *   2. a revisão vira `aceita`
 *   3. `Deal.value` recebe o total — o funil passa a mostrar o valor real
 *   4. o negócio anda para a etapa de fechamento, com `DealStageEntry`
 *   5. o vendedor é notificado
 *   6. os outros links daquela proposta são revogados
 *
 * Se o 1 passasse e o 3 falhasse, o documento estaria aceito e o funil mostraria
 * o valor antigo — e ninguém saberia qual dos dois está certo. Então é uma
 * transação só.
 *
 * ## Os passos 3, 4 e 5 são o que o Ploomes não faz
 *
 * Lá o aceite é um booleano e o funil é outro módulo. Aqui o funil, o canal e o
 * documento estão no mesmo banco, então aceitar **move o negócio** — e é essa a
 * razão de o módulo encaixar em vez de ser importado.
 *
 * ## A conversão `Decimal` → `Float`, e por que ela é explícita
 *
 * `Deal.value` é `Float?` (legado) e `ProposalRevision.total` é
 * `Decimal(18,4)`. A regra do projeto é: campo novo nasce `Decimal`, legado não
 * migra, e a conversão mora numa **fronteira só**, comentada. Esta é a
 * fronteira. `Number(decimal)` aqui é seguro porque o valor já foi arredondado
 * a duas casas por `calcularTotais` — o que se perde é precisão que o número
 * não tem.
 */

export interface EntradaDoAceite {
    shareId: string
    revisionId: string
    nome: string
    ip: string | null
    userAgent: string | null
    contentHash: string
}

export type ResultadoDoAceite =
    | { ok: true; acceptedAt: Date; acceptedByName: string }
    | { ok: false; acceptedAt: Date | null; acceptedByName: string | null }

export async function aceitarDocumento(entrada: EntradaDoAceite): Promise<ResultadoDoAceite> {
    const agora = new Date()

    return prisma.$transaction(async (tx) => {
        /**
         * `updateMany` com `acceptedAt: null` no `where` — e é o detalhe que
         * resolve a corrida.
         *
         * Dois cliques simultâneos chegam aqui juntos. Um `update` por id
         * gravaria os dois, e o segundo sobrescreveria o carimbo do primeiro:
         * a hora registrada seria a do clique duplicado, não a do aceite. Com a
         * condição no `where`, o segundo atualiza **zero linhas** e sabe que
         * perdeu.
         */
        const marcado = await tx.proposalShare.updateMany({
            where: { id: entrada.shareId, acceptedAt: null, revokedAt: null },
            data: {
                acceptedAt: agora,
                acceptedByName: entrada.nome,
                acceptedIp: entrada.ip,
                acceptedUserAgent: entrada.userAgent,
            },
        })

        if (marcado.count === 0) {
            const existente = await tx.proposalShare.findUnique({
                where: { id: entrada.shareId },
                select: { acceptedAt: true, acceptedByName: true },
            })
            return {
                ok: false as const,
                acceptedAt: existente?.acceptedAt ?? null,
                acceptedByName: existente?.acceptedByName ?? null,
            }
        }

        const revisao = await tx.proposalRevision.update({
            where: { id: entrada.revisionId },
            data: { status: 'aceita', contentHash: entrada.contentHash },
            select: {
                total: true,
                proposal: {
                    select: {
                        id: true,
                        kind: true,
                        number: true,
                        workspaceId: true,
                        userId: true,
                        deal: {
                            select: {
                                id: true,
                                status: true,
                                stageId: true,
                                userId: true,
                                stage: { select: { pipelineId: true } },
                            },
                        },
                    },
                },
            },
        })

        const proposta = revisao.proposal
        const negocio = proposta.deal

        /**
         * Os outros links desta proposta são revogados.
         *
         * Sem isto, um link antigo (de uma revisão anterior, por exemplo)
         * continuaria abrindo um documento com valores que já não valem — e o
         * cliente que guardou o primeiro link leria a proposta errada.
         */
        await tx.proposalShare.updateMany({
            where: {
                revision: { proposalId: proposta.id },
                id: { not: entrada.shareId },
                revokedAt: null,
                acceptedAt: null,
            },
            data: { revokedAt: agora },
        })

        // ── o funil ─────────────────────────────────────────────────────────

        /**
         * A conversão de dinheiro passa por `valorParaOFunil`, a fronteira
         * única (`lib/propostas/funil.ts`) — o envio usa a mesma.
         */
        const valor = valorParaOFunil(revisao.total)

        if (negocio.status === 'open') {
            /**
             * A etapa de ganho: a **declarada**, e só então a última.
             *
             * Era só a última por `order`, e a homologação de 21/11/2026 mostrou
             * o preço disso: `DEFAULT_PIPELINE_STAGES` termina numa etapa de
             * retrabalho, então aceitar uma proposta mandava o negócio para lá —
             * e o relatório de funil contava o ganho como retrabalho. Posição
             * não é significado.
             *
             * `isWon` é a declaração da organização, feita na tela de etapas, com
             * índice único parcial garantindo uma por funil. A queda para a
             * última fica: é o comportamento de quem nunca marcou, e mudá-lo
             * mexeria em funil que já roda.
             *
             * Se não houver etapa (funil sem fase, que o seed não produz), o
             * negócio fica onde está: mover para lugar nenhum seria pior.
             */
            const fechamento = negocio.stage.pipelineId
                ? ((await tx.pipelineStage.findFirst({
                      where: { pipelineId: negocio.stage.pipelineId, isWon: true },
                      select: { id: true },
                  })) ??
                  (await tx.pipelineStage.findFirst({
                      where: { pipelineId: negocio.stage.pipelineId },
                      orderBy: { order: 'desc' },
                      select: { id: true },
                  })))
                : null

            await tx.deal.update({
                where: { id: negocio.id },
                data: {
                    value: valor,
                    ...(fechamento && fechamento.id !== negocio.stageId
                        ? { stageId: fechamento.id }
                        : {}),
                },
            })

            /**
             * A passagem de etapa é registrada.
             *
             * `DealStageEntry` é o que faz "tempo médio por fase" e "onde o
             * funil vaza" serem calculáveis — e é a parte em que este schema já
             * era melhor que o do Ploomes, que guarda só o último passo. Mover
             * sem registrar perderia exatamente o dado que o PR de relatórios
             * vai usar.
             */
            if (fechamento && fechamento.id !== negocio.stageId) {
                await tx.dealStageEntry.create({
                    data: {
                        dealId: negocio.id,
                        stageId: fechamento.id,
                        enteredAt: agora,
                        note: `${ROTULO_DO_TIPO[ehTipoDeDocumento(proposta.kind) ? proposta.kind : 'proposta']} ${proposta.number} aceita pelo cliente`,
                    },
                })
            }
        } else {
            // Negócio já fechado: o valor é atualizado, a etapa não. Mover um
            // negócio ganho de volta para o trilho desfaria o fechamento.
            await tx.deal.update({ where: { id: negocio.id }, data: { value: valor } })
        }

        // ── o aviso ─────────────────────────────────────────────────────────

        /**
         * Notifica o dono do negócio; na falta dele, quem criou a proposta.
         *
         * O dono primeiro porque é ele que vai dar o próximo passo. `userId`
         * nulo é legítimo — ver `dealScope` — e nesse caso a notificação fica
         * sem destinatário específico e aparece para a unidade.
         */
        const destinatario = negocio.userId ?? proposta.userId

        const rotulo = ROTULO_DO_TIPO[ehTipoDeDocumento(proposta.kind) ? proposta.kind : 'proposta']
        await tx.notification.create({
            data: {
                workspaceId: proposta.workspaceId,
                userId: destinatario,
                kind: 'proposta_aceita',
                title: `${rotulo} ${proposta.number} aceita`,
                body: `${entrada.nome} aceitou ${rotulo.toLowerCase()} ${proposta.number}.`,
                link: `/vendas/propostas/${proposta.id}`,
            },
        })

        // O aceite consta em Conversas, no fio do documento.
        await registrarEventoDoDocumento(tx, { shareId: entrada.shareId, evento: 'aceitou', nome: entrada.nome })

        return { ok: true as const, acceptedAt: agora, acceptedByName: entrada.nome }
    })
}
