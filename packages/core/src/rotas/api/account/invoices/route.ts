import { NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { accountIdOf } from '@venn/core/lib/account'

/**
 * O histórico de cobranças da conta.
 *
 * Lê o **espelho** (`invoices`), não a API do Asaas. A tela abre toda vez que
 * alguém olha o plano, e uma chamada ao gateway por abertura seria latência
 * emprestada de um terceiro para mostrar o que já temos gravado — além de
 * gastar a cota de requisições deles numa leitura que não decide nada.
 *
 * O link para pagar e o comprovante são **deles** (`invoiceUrl`,
 * `receiptUrl`): quem cobra guarda o documento, e hospedar uma segunda via
 * nossa seria assumir a guarda de documento fiscal sem precisar.
 *
 * Doze linhas porque é um ano de mensalidade — o bastante para conferir o
 * histórico sem paginação, e pouco o bastante para caber numa faixa.
 */
export async function GET() {
    try {
        const workspaceUser = await currentMembership()

        /**
         * Mesma porta do resto da cobrança: OWNER e ADMIN.
         *
         * Fatura mostra quanto a clínica paga e quando — informação de dono.
         * Atendente e gestor não veem a guia Plano, e a rota não pode ser mais
         * aberta que a tela que a chama.
         */
        if (!workspaceUser || !['OWNER', 'ADMIN'].includes(workspaceUser.role)) {
            return NextResponse.json({ error: 'Permissão negada' }, { status: 403 })
        }

        const accountId = await accountIdOf(workspaceUser.workspaceId)
        if (!accountId) {
            return NextResponse.json({ invoices: [] })
        }

        const invoices = await prisma.invoice.findMany({
            where: { accountId },
            orderBy: { dueDate: 'desc' },
            take: 12,
            select: {
                id: true,
                kind: true,
                status: true,
                billingType: true,
                valueCents: true,
                dueDate: true,
                paidAt: true,
                invoiceUrl: true,
                receiptUrl: true,
            },
        })

        return NextResponse.json({ invoices })
    } catch (erro) {
        console.error('[INVOICES] falha ao listar', erro)
        return NextResponse.json({ error: 'Erro ao carregar as cobranças' }, { status: 500 })
    }
}
