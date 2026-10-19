import prisma from '@/lib/prisma'
import { createLogger } from '../../logger'

const log = createLogger('CRON:DUNNING')

/**
 * O dia em que a conta para de operar — e o dia em que o plano cancelado acaba.
 *
 * Duas varreduras, as duas de borda de data, e por isso aqui e não no webhook:
 * o evento que põe a conta em atraso chega no dia do vencimento, mas o corte é
 * três dias depois, quando não há evento nenhum para reagir.
 *
 * **O que o corte faz** é o mesmo que a avaliação vencida já fazia
 * (PRODUCT.md §3): somente-leitura. Mensagens continuam chegando, o histórico
 * inteiro continua legível e exportável, e a tela de plano continua aberta —
 * para que pagar seja sempre possível. O que para é enviar e criar.
 *
 * **O WhatsApp não é desconectado.** Derrubar a linha de uma clínica por três
 * dias de atraso custa à clínica o relacionamento com os pacientes dela, e
 * custa a nós um pareamento novo quando ela pagar. A conta volta no instante em
 * que o pagamento confirma, sem reconectar nada.
 */
export async function runBillingDunning(): Promise<void> {
    const agora = new Date()

    await cortarCarenciaVencida(agora)
    await encerrarPlanosCancelados(agora)
}

/**
 * Atraso além da carência vira somente-leitura.
 *
 * `readOnlySince: null` no filtro é o que torna a varredura idempotente: a
 * conta já cortada não é cortada de novo, e a data do corte continua sendo a do
 * primeiro — que é a que vale para contar os prazos de retenção.
 */
async function cortarCarenciaVencida(agora: Date): Promise<void> {
    const vencidas = await prisma.subscription.findMany({
        where: {
            status: 'past_due',
            graceEndsAt: { lte: agora },
            readOnlySince: null,
        },
        select: { id: true, accountId: true, graceEndsAt: true },
    })

    if (vencidas.length === 0) {
        log.debug('nenhuma carência vencida')
        return
    }

    for (const assinatura of vencidas) {
        await prisma.subscription.update({
            where: { id: assinatura.id },
            data: { readOnlySince: agora },
        })

        log.warn(
            `conta ${assinatura.accountId} em somente-leitura: carência venceu em ` +
                `${assinatura.graceEndsAt?.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        )
    }

    log.info(`${vencidas.length} conta(s) cortada(s) por atraso`)
}

/**
 * O plano cancelado acaba no fim do ciclo pago, não no clique.
 *
 * Cancelar é a decisão do cliente de **não renovar**; ele pagou o mês e usa o
 * mês. Entre o clique e esta data a conta opera normalmente, e é por isso que o
 * cancelamento não mexe em `readOnlySince` na hora.
 *
 * Os adicionais morrem junto, e por construção: o cancelamento marca `endsAt`
 * neles com a mesma data, então a contagem de unidades já os ignora a partir
 * daqui. Não há segunda varredura para eles.
 */
async function encerrarPlanosCancelados(agora: Date): Promise<void> {
    const acabaram = await prisma.subscription.findMany({
        where: {
            status: 'canceled',
            currentPeriodEnd: { lte: agora },
            readOnlySince: null,
        },
        select: { id: true, accountId: true, currentPeriodEnd: true },
    })

    if (acabaram.length === 0) return

    for (const assinatura of acabaram) {
        await prisma.subscription.update({
            where: { id: assinatura.id },
            data: { readOnlySince: agora },
        })

        log.info(
            `conta ${assinatura.accountId}: plano cancelado chegou ao fim do ciclo ` +
                `(${assinatura.currentPeriodEnd?.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}); ` +
                'somente-leitura'
        )
    }
}
