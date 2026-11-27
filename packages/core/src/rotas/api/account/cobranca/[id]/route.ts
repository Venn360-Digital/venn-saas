import { NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { accountIdOf } from '@venn/core/lib/account'
import { currentMembership } from '@venn/core/lib/auth/workspace'

/**
 * O estado de uma tentativa de cobrança — para a tela do Pix esperar sem
 * recarregar.
 *
 * ## Por que ela lê o NOSSO banco, e nunca o Asaas
 *
 * Porque a verdade sobre "foi pago" já mora aqui: o webhook grava `paidAt` e
 * `appliedAt` em `asaas_checkouts`, e é essa gravação que libera o adicional.
 * Perguntar ao Asaas a cada três segundos criaria uma **segunda** fonte para a
 * mesma pergunta, com duas respostas possíveis no mesmo instante — e a tela
 * poderia anunciar "pago" antes de a entrega ter acontecido.
 *
 * E o navegador não fala com o Asaas em caminho nenhum: a chave é da plataforma
 * e não existe fora do Worker.
 *
 * ## O que ela devolve, e por que `entregue` é separado de `pago`
 *
 * São dois instantes distintos. `pago` é o dinheiro ter entrado; `entregue` é o
 * crédito ou a unidade já estar na conta. Entre eles há uma janela de
 * milissegundos em que o webhook gravou `paidAt` e ainda não terminou
 * `aplicarAdicionais` — e a tela que fechasse o diálogo em `pago` mandaria a
 * pessoa para uma conta que ainda não tem o que ela comprou.
 *
 * Então quem decide fechar é `entregue`.
 *
 * ## Isolamento
 *
 * A tentativa é buscada **pelo id e pela conta** — nunca pelo id só. Sem o
 * segundo termo, o id de uma tentativa de outra clínica devolveria o valor e o
 * estado da compra dela. É o mesmo cuidado que `contaDoMaster` aplica aos
 * cartões salvos.
 */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params

    const membro = await currentMembership()
    if (!membro) {
        return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    /**
     * Mesmo recorte de papel de quem cria a cobrança.
     *
     * `POST /api/account/subscription` exige OWNER ou ADMIN, então a consulta do
     * estado dela segue a mesma regra: um ATENDENTE não precisa saber quanto a
     * clínica está comprando.
     */
    if (!['OWNER', 'ADMIN'].includes(membro.role)) {
        return NextResponse.json({ error: 'Permissão negada' }, { status: 403 })
    }

    const accountId = await accountIdOf(membro.workspaceId)
    if (!accountId) {
        return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })
    }

    const tentativa = await prisma.asaasCheckout.findFirst({
        where: { id, accountId },
        select: {
            id: true,
            kind: true,
            status: true,
            valueCents: true,
            paidAt: true,
            appliedAt: true,
            link: true,
            createdAt: true,
        },
    })

    if (!tentativa) {
        return NextResponse.json({ error: 'Cobrança não encontrada' }, { status: 404 })
    }

    return NextResponse.json({
        id: tentativa.id,
        kind: tentativa.kind,
        status: tentativa.status,
        valueCents: tentativa.valueCents,
        /** O dinheiro entrou. */
        pago: Boolean(tentativa.paidAt),
        /** O que foi comprado já está na conta — é isto que fecha o diálogo. */
        entregue: Boolean(tentativa.appliedAt),
        /** A fatura do Asaas, como alternativa ao QR. */
        invoiceUrl: tentativa.link || null,
        createdAt: tentativa.createdAt,
    })
}
