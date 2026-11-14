import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'

/**
 * Editar um domínio de envio.
 *
 * ## O domínio **não** entra aqui
 *
 * Nem por descuido: no SES, o domínio **é** a identidade. Trocá-lo não é mudar
 * um campo, é criar outra identidade, com outros três tokens de DKIM e outra
 * verificação — e os registros que o cliente já publicou deixariam de valer sem
 * nada na tela dizer isso.
 *
 * Quem errou o domínio cadastra outro e apaga este. É mais trabalho e é honesto:
 * o estado de verificação pertence ao domínio, não à linha.
 *
 * O que se edita é o que é **nosso lado** do envelope: o endereço antes do @, o
 * nome que aparece na caixa de entrada, e para onde as respostas vão. Nenhum dos
 * três mexe no DKIM, então nenhum deles invalida a verificação.
 */

const editarSchema = z.object({
    /** A parte antes do @. Sem arroba, sem ponto no fim. */
    fromLocal: z
        .string()
        .trim()
        .toLowerCase()
        .min(1, 'Informe o que vem antes do @')
        .max(64)
        .regex(
            /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/,
            'Use só letras, números, ponto, hífen ou sublinhado — e sem o @'
        ),
    fromName: z.string().trim().min(1, 'Informe o nome que aparece na caixa de entrada').max(120),
    replyTo: z.string().trim().email('Informe um e-mail válido').max(200),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const existe = await prisma.emailSender.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: { id: true },
    })
    if (!existe) return new NextResponse('Domínio não encontrado', { status: 404 })

    const corpo = editarSchema.safeParse(await request.json())
    if (!corpo.success) {
        const primeiro = corpo.error.issues[0]
        // O campo volta para a tela pôr o erro abaixo dele, como manda o
        // DESIGN.md — nunca toast, nunca resumo no topo.
        return NextResponse.json(
            { error: primeiro.message, campo: primeiro.path[0] ?? null },
            { status: 400 }
        )
    }

    const atualizado = await prisma.emailSender.update({
        where: { id },
        data: corpo.data,
        select: { fromLocal: true, domain: true, fromName: true, replyTo: true },
    })

    return NextResponse.json({
        from: `${atualizado.fromLocal}@${atualizado.domain}`,
        fromLocal: atualizado.fromLocal,
        fromName: atualizado.fromName,
        replyTo: atualizado.replyTo,
    })
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const remetente = await prisma.emailSender.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: { id: true, _count: { select: { broadcasts: true } } },
    })
    if (!remetente) return new NextResponse('Domínio não encontrado', { status: 404 })

    /**
     * Domínio com campanha no histórico não é apagado.
     *
     * `Broadcast.senderId` aponta para cá, e apagar levaria a referência: a
     * campanha ficaria sem dizer de onde saiu, e o relatório de uma campanha
     * antiga passaria a mentir sobre o remetente. Apagar o **registro** não
     * desfaz os e-mails que já saíram.
     *
     * A identidade no SES também fica: ela é da conta, e remover por aqui
     * invalidaria o DKIM de um domínio que talvez outra unidade esteja usando.
     */
    if (remetente._count.broadcasts > 0) {
        return NextResponse.json(
            {
                error: `Este domínio já enviou ${remetente._count.broadcasts} campanha(s). Apagá-lo deixaria o histórico sem remetente.`,
            },
            { status: 409 }
        )
    }

    await prisma.emailSender.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
}
