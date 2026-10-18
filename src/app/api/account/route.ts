import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'
import { contaDoMaster, unidadesDaConta } from '@/lib/account'
import { planFor } from '@/lib/plans'

/**
 * A conta — quem assina, paga e abriga as unidades.
 *
 * Ela existia no banco desde 2026-10-18 e não tinha tela nenhuma: o nome vinha
 * do primeiro workspace, o CNPJ e a logo moravam na unidade. Esta rota é o que
 * a guia **Conta da Clínica** lê e grava no primeiro cartão.
 *
 * O nome não é editável (decisão do Andre): nasce do cadastro, que pergunta um
 * nome só, e quando tiver de mudar muda no banco.
 */

const dadosSchema = z.object({
    /**
     * CPF (11) ou CNPJ (14), em dígitos. Vazio limpa o campo.
     *
     * Os dois, por decisão do Andre: dentista sozinho às vezes não tem CNPJ, e
     * o Asaas recebe ambos no mesmo campo. A tela pontua conforme o tamanho.
     */
    cpfCnpj: z
        .string()
        .trim()
        .regex(/^(\d{11}|\d{14})?$/, 'Informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).')
        .optional(),
    /** `null` remove a logomarca e devolve a marca do produto ao cabeçalho. */
    logo: z.string().nullable().optional(),
})

export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const workspace = await prisma.workspace.findUnique({
        where: { id: auth.member.workspaceId },
        select: {
            accountId: true,
            account: { select: { name: true, cpfCnpj: true, logo: true, ownerUserId: true } },
        },
    })
    if (!workspace) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })

    const [unidades, subscription] = await Promise.all([
        unidadesDaConta(workspace.accountId),
        prisma.subscription.findUnique({
            where: { accountId: workspace.accountId },
            select: { plan: true },
        }),
    ])

    return NextResponse.json({
        name: workspace.account.name,
        cpfCnpj: workspace.account.cpfCnpj,
        logo: workspace.account.logo,
        /** Se quem pergunta é o MASTER — a tela esconde o que ele não pode fazer. */
        souMaster: workspace.account.ownerUserId === auth.member.userId,
        plano: subscription ? planFor(subscription.plan).name : null,
        unidades,
    })
}

/** O documento de cobrança e a logomarca. Do MASTER: os dois são da fatura e do cabeçalho. */
export async function PATCH(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const master = await contaDoMaster(auth.member.workspaceId, auth.member.userId)
    if (!master.ok) {
        return NextResponse.json(
            {
                error:
                    master.status === 403
                        ? 'Só o responsável pela conta pode alterar o documento de cobrança e a logomarca.'
                        : master.error,
            },
            { status: master.status }
        )
    }

    const parsed = dadosSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
            { status: 400 }
        )
    }

    const conta = await prisma.account.update({
        where: { id: master.accountId },
        data: {
            // Vazio apaga; ausente não mexe. Sem a distinção, limpar um
            // documento digitado por engano seria impossível pela tela.
            cpfCnpj: parsed.data.cpfCnpj === undefined ? undefined : parsed.data.cpfCnpj || null,
            logo: parsed.data.logo === undefined ? undefined : parsed.data.logo,
        },
        select: { name: true, cpfCnpj: true, logo: true },
    })

    return NextResponse.json(conta)
}
