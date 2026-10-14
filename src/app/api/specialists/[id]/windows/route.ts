import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, getWorkspaceMember, hasEditorRole } from '@/lib/auth/workspace'

/**
 * As faixas de horário em que um especialista atende.
 *
 * O corpo traz a lista **inteira** e substitui a anterior. Uma janela não tem
 * identidade para quem edita — a pessoa mexe numa grade de horários, não em
 * registros —, e mandar o conjunto evita a dança de criar/alterar/excluir em
 * três requisições que podem falhar no meio e deixar a grade pela metade.
 */

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

const janelaSchema = z
    .object({
        weekday: z.number().int().min(0).max(6),
        startTime: z.string().regex(HORA, 'Horário inválido.'),
        endTime: z.string().regex(HORA, 'Horário inválido.'),
        agentCanBook: z.boolean().optional(),
        /** Ids de Itens com categoria `procedure`. */
        procedureIds: z.array(z.string()).optional(),
    })
    .refine((j) => j.startTime < j.endTime, {
        message: 'A janela precisa terminar depois de começar.',
    })

const corpoSchema = z.object({ windows: z.array(janelaSchema).max(60) })

/** Duas faixas do mesmo dia que se cruzam tornam a disponibilidade ambígua. */
function sobrepostas(janelas: z.infer<typeof janelaSchema>[]): string | null {
    const porDia = new Map<number, { startTime: string; endTime: string }[]>()
    for (const j of janelas) {
        const lista = porDia.get(j.weekday) ?? []
        lista.push(j)
        porDia.set(j.weekday, lista)
    }
    for (const [dia, lista] of porDia) {
        const ordenadas = [...lista].sort((a, b) => a.startTime.localeCompare(b.startTime))
        for (let i = 1; i < ordenadas.length; i++) {
            if (ordenadas[i].startTime < ordenadas[i - 1].endTime) {
                const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
                return `Duas janelas se sobrepõem na ${nomes[dia]}.`
            }
        }
    }
    return null
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (!hasEditorRole(auth.member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const especialista = await prisma.specialist.findFirst({
        where: { id, workspaceId: auth.member.workspaceId },
        select: { id: true },
    })
    if (!especialista) {
        return NextResponse.json({ error: 'Especialista não encontrado' }, { status: 404 })
    }

    const parsed = corpoSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
            { status: 400 }
        )
    }
    const { windows } = parsed.data

    const conflito = sobrepostas(windows)
    if (conflito) return NextResponse.json({ error: conflito }, { status: 400 })

    /**
     * Os procedimentos têm que ser desta clínica e ser procedimentos.
     *
     * Liberar um Item que é produto (um creme dental) não tem duração e o agente
     * não saberia quanto tempo reservar.
     */
    const pedidos = [...new Set(windows.flatMap((w) => w.procedureIds ?? []))]
    if (pedidos.length > 0) {
        const validos = await prisma.productService.findMany({
            where: {
                id: { in: pedidos },
                workspaceId: auth.member.workspaceId,
                category: 'procedure',
            },
            select: { id: true },
        })
        if (validos.length !== pedidos.length) {
            return NextResponse.json(
                { error: 'Um dos procedimentos não existe ou não é um procedimento.' },
                { status: 400 }
            )
        }
    }

    // Substituição inteira numa transação: a grade nunca fica pela metade.
    await prisma.$transaction(async (tx) => {
        await tx.specialistWindow.deleteMany({ where: { specialistId: id } })
        for (const w of windows) {
            await tx.specialistWindow.create({
                data: {
                    specialistId: id,
                    weekday: w.weekday,
                    startTime: w.startTime,
                    endTime: w.endTime,
                    agentCanBook: w.agentCanBook ?? false,
                    procedures: {
                        create: (w.procedureIds ?? []).map((productServiceId) => ({ productServiceId })),
                    },
                },
            })
        }
    })

    return NextResponse.json({ success: true, count: windows.length })
}
