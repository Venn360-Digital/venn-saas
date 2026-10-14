import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, getWorkspaceMember, hasEditorRole } from '@/lib/auth/workspace'

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (!hasEditorRole(auth.member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const linha = await prisma.scheduleException.findFirst({
        where: { id, workspaceId: auth.member.workspaceId },
        select: { id: true },
    })
    if (!linha) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

    await prisma.scheduleException.delete({ where: { id } })
    return NextResponse.json({ success: true })
}
