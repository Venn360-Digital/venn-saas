import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
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

/** As estratégias que a rota aceita. Fora disto, mantém a que estava. */
const ESTRATEGIAS = ['nenhuma', 'rodizio', 'balanceado']

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
        /**
         * A distribuição mescla **por chave**, não em bloco: a tela de
         * Automações manda só a estratégia, e a guia de Usuários não encosta
         * nela. Substituir o objeto inteiro faria mexer na estratégia apagar o
         * interruptor sem ninguém pedir.
         */
        distribuicao: {
            estrategia: ESTRATEGIAS.includes(body?.distribuicao?.estrategia)
                ? body.distribuicao.estrategia
                : current.distribuicao.estrategia,
            soDisponiveis:
                typeof body?.distribuicao?.soDisponiveis === 'boolean'
                    ? body.distribuicao.soDisponiveis
                    : current.distribuicao.soDisponiveis,
        },
        /* `minutosParaAusente` saiu daqui em 2026-11-09: a queda para ausente
           é atributo da pessoa (campo Ausência, na ficha) e deixou de ser
           ajuste de conta. Ver `MINUTOS_PARA_AUSENTE_PADRAO`. Corpo que ainda
           mande a chave é ignorado — e o `...DEFAULT_AUTOMATIONS` abaixo não a
           reintroduz, porque ela saiu do padrão também. */
    }

    await prisma.workspace.update({
        where: { id: auth.member.workspaceId },
        data: { automations: { ...DEFAULT_AUTOMATIONS, ...next } as object },
    })

    return NextResponse.json(next)
}
