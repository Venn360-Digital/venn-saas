import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'

const KINDS = new Set(['won', 'lost'])

/**
 * Os motivos de ganho e de perda que a clínica alimenta.
 *
 * Saíram do código — eram sete de perda, fixos, e nenhum de ganho — porque a
 * razão pela qual uma clínica fecha é dela: indicação numa, parcelamento em
 * outra. `kind` mantém os dois lados separados, para que a lista oferecida no
 * fechamento seja a do desfecho escolhido.
 */
export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const reasons = await prisma.dealOutcomeReason.findMany({
        where: { workspaceId: auth.member.workspaceId },
        orderBy: [{ kind: 'asc' }, { order: 'asc' }],
        select: { id: true, kind: true, name: true, order: true, isActive: true },
    })

    return NextResponse.json({
        won: reasons.filter((r) => r.kind === 'won'),
        lost: reasons.filter((r) => r.kind === 'lost'),
    })
}

export async function POST(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const kind = String(body.kind ?? '')
    const name = String(body.name ?? '').trim()
    if (!KINDS.has(kind)) return NextResponse.json({ error: 'Finalização inválida' }, { status: 400 })
    if (!name) return NextResponse.json({ error: 'Informe o motivo' }, { status: 400 })

    const last = await prisma.dealOutcomeReason.findFirst({
        where: { workspaceId: auth.member.workspaceId, kind },
        orderBy: { order: 'desc' },
        select: { order: true },
    })

    const reason = await prisma.dealOutcomeReason.create({
        data: {
            workspaceId: auth.member.workspaceId,
            kind,
            name,
            order: (last?.order ?? 0) + 1,
        },
        select: { id: true, kind: true, name: true, order: true, isActive: true },
    })
    return NextResponse.json(reason, { status: 201 })
}

export async function PATCH(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'Motivo não informado' }, { status: 400 })

    // Escopado pelo workspace antes de escrever: o id vem do cliente.
    const existing = await prisma.dealOutcomeReason.findFirst({
        where: { id, workspaceId: auth.member.workspaceId },
        select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Motivo não encontrado' }, { status: 404 })

    const data: { name?: string; isActive?: boolean } = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive

    const reason = await prisma.dealOutcomeReason.update({
        where: { id },
        data,
        select: { id: true, kind: true, name: true, order: true, isActive: true },
    })
    return NextResponse.json(reason)
}

/**
 * Desativa em vez de apagar.
 *
 * Um negócio fechado aponta para o motivo pelo qual fechou; apagar a linha
 * apagaria a explicação de um fato que já aconteceu. Desativado, o motivo para
 * de ser oferecido e continua legível no histórico.
 */
export async function DELETE(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const id = new URL(request.url).searchParams.get('id') ?? ''
    const existing = await prisma.dealOutcomeReason.findFirst({
        where: { id, workspaceId: auth.member.workspaceId },
        select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Motivo não encontrado' }, { status: 404 })

    await prisma.dealOutcomeReason.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
}
