import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'
import { contaDoMaster, unidadesDaConta } from '@/lib/account'
import { planFor } from '@/lib/plans'
import { CODIGOS_DE_MOEDA, MOEDA_PADRAO } from '@/lib/moedas'

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

    /**
     * A moeda em que a conta vê dinheiro. ISO 4217, da lista que a tela oferece.
     *
     * Validada contra a lista e não contra `/^[A-Z]{3}$/`: um código que o
     * `Intl` não conhece viraria exceção em toda tela que escreve dinheiro, e a
     * borda é onde isso custa um 400 em vez de um 500.
     *
     * Não tem o par "vazio limpa" dos outros campos — moeda nenhuma não é um
     * estado válido da conta, e o banco tem `BRL` por omissão.
     */
    currency: z
        .enum(CODIGOS_DE_MOEDA as [string, ...string[]], {
            message: 'Escolha uma das moedas da lista.',
        })
        .optional(),

    /**
     * O endereço de cobrança, em campos separados.
     *
     * Todos opcionais aqui e exigidos **na hora de contratar**: a avaliação de
     * 7 dias não pede endereço. Vazio limpa, ausente não mexe — a mesma regra
     * do documento.
     */
    postalCode: z
        .string()
        .trim()
        .regex(/^(\d{8})?$/, 'O CEP tem 8 dígitos.')
        .optional(),
    address: z.string().trim().max(120).optional(),
    addressNumber: z.string().trim().max(20).optional(),
    complement: z.string().trim().max(60).optional(),
    province: z.string().trim().max(60).optional(),
    city: z.string().trim().max(60).optional(),
    state: z
        .string()
        .trim()
        .regex(/^([A-Za-z]{2})?$/, 'A UF tem 2 letras.')
        .optional(),
    billingPhone: z
        .string()
        .trim()
        .regex(/^(\d{10,11})?$/, 'O telefone precisa de DDD e 8 ou 9 dígitos.')
        .optional(),
})

/** Os campos do endereço, para não repetir a lista em três lugares. */
const CAMPOS_DE_ENDERECO = [
    'postalCode',
    'address',
    'addressNumber',
    'complement',
    'province',
    'city',
    'state',
    'billingPhone',
] as const

export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const workspace = await prisma.workspace.findUnique({
        where: { id: auth.member.workspaceId },
        select: {
            accountId: true,
            account: {
                select: {
                    name: true,
                    cpfCnpj: true,
                    logo: true,
                    ownerUserId: true,
                    postalCode: true,
                    address: true,
                    addressNumber: true,
                    complement: true,
                    province: true,
                    city: true,
                    state: true,
                    billingPhone: true,
                    currency: true,
                },
            },
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

    /* O dono não vai na resposta em si — vira `souMaster`, logo abaixo. */
    const daConta = {
        ...workspace.account,
        ownerUserId: undefined,
        /* Conta gravada antes da coluna existir, ou com um código que saiu da
           lista, abre a tela em real em vez de num `<select>` sem seleção. */
        currency: workspace.account.currency || MOEDA_PADRAO,
    }

    return NextResponse.json({
        ...daConta,
        /** Se quem pergunta é o MASTER — a tela esconde o que ele não pode fazer. */
        souMaster: workspace.account.ownerUserId === auth.member.userId,
        plano: subscription ? planFor(subscription.plan).name : null,
        unidades,
    })
}

/**
 * O documento de cobrança, a moeda e a logomarca. Do MASTER: a fatura, o
 * cabeçalho e a moeda em que a conta inteira lê dinheiro são decisões de quem
 * assina, não de quem opera uma unidade.
 */
export async function PATCH(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const master = await contaDoMaster(auth.member.workspaceId, auth.member.userId)
    if (!master.ok) {
        return NextResponse.json(
            {
                error:
                    master.status === 403
                        ? 'Só o responsável pela conta pode alterar o documento de cobrança, a moeda e a logomarca.'
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

    /** Vazio apaga; ausente não mexe. Sem a distinção, limpar um campo
        digitado por engano seria impossível pela tela. */
    const endereco = Object.fromEntries(
        CAMPOS_DE_ENDERECO.filter((campo) => parsed.data[campo] !== undefined).map((campo) => [
            campo,
            campo === 'state'
                ? parsed.data[campo]!.toUpperCase() || null
                : parsed.data[campo] || null,
        ])
    )

    const conta = await prisma.account.update({
        where: { id: master.accountId },
        data: {
            cpfCnpj: parsed.data.cpfCnpj === undefined ? undefined : parsed.data.cpfCnpj || null,
            logo: parsed.data.logo === undefined ? undefined : parsed.data.logo,
            currency: parsed.data.currency ?? undefined,
            ...endereco,
        },
        select: { name: true, cpfCnpj: true, logo: true, currency: true },
    })

    return NextResponse.json(conta)
}
