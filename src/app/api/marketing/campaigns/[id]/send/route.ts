import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { congelarDestinatarios, iniciarDisparo } from '@/trabalhos/servicos/broadcast'
import { portaoDeDisparo, semDestinatarios } from '@/lib/marketing/portao'

const sendSchema = z.object({
    /** ISO. Ausente ou no passado = dispara agora. */
    scheduledAt: z.string().datetime().optional(),
})

/**
 * Dispara agora ou agenda.
 *
 * O portão — configuração do canal, alcance das listas e teto do plano — mora
 * em `lib/marketing/portao.ts` porque o **cron de agendamento aplica o mesmo**.
 * Duas portas com a mesma regra escrita em dois lugares divergem, e aqui a
 * divergência seria a pior possível: a que falharia é a do cron, de madrugada,
 * sem ninguém para ler o log.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const { id } = await params

    /**
     * O escopo primeiro, e separado do portão.
     *
     * O portão lê a campanha pelo id, sem workspace — ele serve ao cron, que
     * não tem um. Então quem vem pela web confere a posse **antes**: id de
     * outra unidade tem de dar 404 aqui, e não atravessar para o portão.
     */
    const minha = await prisma.broadcast.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: { status: true },
    })
    if (!minha) return new NextResponse('Campanha não encontrada', { status: 404 })
    if (minha.status !== 'draft') {
        return NextResponse.json(
            { error: 'Só uma campanha em rascunho pode ser disparada ou agendada.' },
            { status: 400 }
        )
    }

    const portao = await portaoDeDisparo(id)
    if (!portao.ok) {
        return NextResponse.json({ error: portao.error }, { status: portao.status })
    }

    const { scheduledAt } = sendSchema.parse(await request.json().catch(() => ({})))
    const quando = scheduledAt ? new Date(scheduledAt) : null
    const agendarParaFuturo = quando !== null && quando.getTime() > Date.now()

    if (agendarParaFuturo) {
        /**
         * Agendada: o cron congela e dispara na hora, e a lista fica atual.
         *
         * O portão acabou de passar, mas **o cron o aplica de novo** — dias
         * podem passar até a hora chegar, e nesse intervalo o DKIM pode sair
         * do ar e o teto do mês pode estourar com outro disparo.
         */
        await prisma.broadcast.update({
            where: { id },
            data: { status: 'scheduled', scheduledAt: quando },
        })
        return NextResponse.json({ id, status: 'scheduled', scheduledAt: quando })
    }

    // Imediata: congela agora e enfileira o fan-out.
    const total = await congelarDestinatarios(id)
    if (total === 0) {
        return NextResponse.json({ error: semDestinatarios(portao.canal) }, { status: 400 })
    }
    await iniciarDisparo(id)
    return NextResponse.json({ id, status: 'running', totalCount: total })
}
