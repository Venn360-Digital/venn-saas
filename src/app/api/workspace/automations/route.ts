import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, getWorkspaceMember, hasEditorRole } from '@/lib/auth/workspace'
import { DEFAULT_AUTOMATIONS, readAutomations, type Automations } from '@/lib/automations'
import { connectedWhatsApp } from '@/lib/intake'

/** O que a clínica deixou ligado. */
export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const workspace = await prisma.workspace.findUnique({
        where: { id: auth.member.workspaceId },
        select: { automations: true },
    })

    // O envio automático por fase depende do canal: no oficial da Meta, texto
    // livre fora da janela de 24h exige template aprovado, que não existe aqui.
    const channel = await connectedWhatsApp(auth.member.workspaceId)

    return NextResponse.json({
        ...readAutomations(workspace?.automations),
        canAutoSend: Boolean(channel),
    })
}

export async function PATCH(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Configuração do workspace: vale para todo mundo que atende, então não é
    // de um ATENDENTE mudar.
    if (!hasEditorRole(auth.member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const workspace = await prisma.workspace.findUnique({
        where: { id: auth.member.workspaceId },
        select: { automations: true },
    })

    const current = readAutomations(workspace?.automations)
    const body = await request.json().catch(() => ({}))

    // Mescla em vez de substituir: a tela manda só o que o usuário mexeu, e uma
    // chave ausente não pode desligar o que estava ligado.
    const next: Automations = {
        followUpTasks: typeof body.followUpTasks === 'boolean' ? body.followUpTasks : current.followUpTasks,
        briefing: typeof body.briefing === 'boolean' ? body.briefing : current.briefing,
        briefingHour:
            Number.isInteger(body.briefingHour) && body.briefingHour >= 0 && body.briefingHour <= 23
                ? body.briefingHour
                : current.briefingHour,
        briefingWhatsApp:
            typeof body.briefingWhatsApp === 'boolean' ? body.briefingWhatsApp : current.briefingWhatsApp,
    }

    await prisma.workspace.update({
        where: { id: auth.member.workspaceId },
        data: { automations: { ...DEFAULT_AUTOMATIONS, ...next } },
    })

    return NextResponse.json(next)
}
