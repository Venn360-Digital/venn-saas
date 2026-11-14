import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember, MANAGER_ROLES } from '@venn/core/lib/auth/workspace'
import { accountIdOf } from '@venn/core/lib/account'
import type { Prisma } from '@venn/db'
import { comFusoNasConfiguracoes, lerFusoDasConfiguracoes } from '@venn/core/lib/fuso-da-unidade'
import { FUSOS } from '@venn/core/lib/fusos'

/**
 * Os dados de **uma** unidade: nome, endereço, telefone, fuso horário.
 *
 * Por id, e não "a unidade aberta", porque o cartão de unidades edita qualquer
 * clínica da conta — foi a decisão do Andre sobre o acordeão: clicar na segunda
 * clínica abre os campos dela. Sem esta rota, arrumar o telefone da segunda
 * exigiria trocar de clínica, esperar a tela recarregar, arrumar e voltar —
 * numa tela chamada "unidades da conta".
 *
 * Grava **uma** unidade por chamada. É o acordeão que garante isso: só uma está
 * aberta, então o Salvar nunca tem três clínicas em mãos, e com isso não existe
 * meia gravação para desfazer.
 */

const schema = z.object({
    name: z.string().trim().min(2, 'Dê um nome à unidade.').max(80),
    address: z.string().trim().max(200).nullable().optional(),
    /** Dígitos ou vazio. Vazio limpa o campo. */
    phone: z
        .string()
        .trim()
        .regex(/^(\d{10,11})?$/, 'O telefone precisa ter DDD e 8 ou 9 dígitos.')
        .nullable()
        .optional(),
    /**
     * O relógio em que a unidade opera — o que é "hoje" para ela.
     *
     * Recusado aqui quando não é um dos fusos da lista, em vez de deixar
     * `comFusoNasConfiguracoes` descartar calado: descarte silencioso numa
     * gravação que a pessoa acabou de pedir aparece como "a tela não salva o
     * fuso", e o motivo fica a dois módulos de distância de quem procura.
     */
    fusoHorario: z
        .string()
        .refine((v) => FUSOS.some((f) => f.value === v), 'Fuso horário não reconhecido.')
        .optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { id } = await params

    /**
     * A unidade tem de ser **da mesma conta** de quem está pedindo.
     *
     * É a conferência que impede o caso óbvio: postar o id da clínica de outro
     * cliente nesta rota. A participação não serve de prova aqui — o MASTER
     * edita unidades de que não participa, e é justamente para isso que a tela
     * existe —, então o parentesco é o que vale.
     */
    const [contaDeQuemPede, alvo] = await Promise.all([
        accountIdOf(auth.member.workspaceId),
        prisma.workspace.findUnique({
            where: { id },
            select: {
                accountId: true,
                account: { select: { ownerUserId: true } },
                // O fuso é uma chave dentro de `settings`: gravar sem ler
                // apagaria o resto do JSON (tema, idioma).
                settings: true,
            },
        }),
    ])

    if (!alvo || !contaDeQuemPede || alvo.accountId !== contaDeQuemPede) {
        // 404 e não 403: dizer "sem permissão" para um id de outra conta
        // confirmaria que aquele id existe.
        return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 404 })
    }

    /**
     * Quem pode: o MASTER da conta, ou quem administra **aquela** unidade.
     *
     * O MASTER porque as unidades são dele. E o OWNER/ADMIN da própria unidade
     * porque os dados dali são o trabalho dele, e numa clínica com dois sócios
     * não é razoável que só um possa corrigir o endereço.
     */
    const souMaster = alvo.account.ownerUserId === auth.member.userId
    if (!souMaster) {
        const naUnidade = await prisma.workspaceUser.findFirst({
            where: { userId: auth.member.userId, workspaceId: id, isActive: true },
            select: { role: true },
        })
        if (!naUnidade || !(MANAGER_ROLES as string[]).includes(naUnidade.role)) {
            return NextResponse.json(
                { error: 'Você não tem permissão para alterar os dados desta unidade.' },
                { status: 403 }
            )
        }
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
            { status: 400 }
        )
    }

    const unidade = await prisma.workspace.update({
        where: { id },
        data: {
            name: parsed.data.name,
            address: parsed.data.address === undefined ? undefined : parsed.data.address || null,
            phone: parsed.data.phone === undefined ? undefined : parsed.data.phone || null,
            settings:
                parsed.data.fusoHorario === undefined
                    ? undefined
                    : (comFusoNasConfiguracoes(
                          alvo.settings,
                          parsed.data.fusoHorario
                      ) as Prisma.InputJsonValue),
        },
        select: { id: true, name: true, address: true, phone: true, settings: true },
    })

    // `settings` não volta cru: a tela quer o fuso, e o resto do JSON é assunto
    // de outras telas.
    return NextResponse.json({
        id: unidade.id,
        name: unidade.name,
        address: unidade.address,
        phone: unidade.phone,
        fusoHorario: lerFusoDasConfiguracoes(unidade.settings),
    })
}
