import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, getWorkspaceMember, hasEditorRole } from '@/lib/auth/workspace'
import { feriadosNacionais } from '@/lib/holidays'

/**
 * O calendário da clínica: feriados e fechamentos.
 *
 * O GET devolve as duas coisas **juntas e já resolvidas** para o ano pedido: os
 * feriados nacionais calculados, com a decisão da clínica aplicada em cima, e os
 * fechamentos próprios. A tela não precisa saber que os nacionais vêm de um
 * cálculo e os outros do banco.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

const entradaSchema = z
    .object({
        name: z.string().trim().min(1, 'Dê um nome ao fechamento.').max(120),
        startsOn: z.string().regex(DATA, 'Data inválida.'),
        endsOn: z.string().regex(DATA, 'Data inválida.'),
        allDay: z.boolean().default(true),
        startTime: z.string().regex(HORA).nullable().optional(),
        endTime: z.string().regex(HORA).nullable().optional(),
        blocks: z.boolean().default(true),
    })
    .refine((e) => e.startsOn <= e.endsOn, { message: 'O fim não pode ser antes do começo.' })
    .refine((e) => e.allDay || (e.startTime && e.endTime && e.startTime < e.endTime), {
        message: 'Um fechamento parcial precisa de hora de início e de fim.',
    })

export async function GET(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const ano = Number(new URL(request.url).searchParams.get('year')) || new Date().getFullYear()

    const linhas = await prisma.scheduleException.findMany({
        where: { workspaceId: auth.member.workspaceId },
        orderBy: [{ startsOn: 'asc' }],
    })

    const decisoes = new Map(
        linhas.filter((l) => l.holidayKey).map((l) => [l.holidayKey as string, l.blocks])
    )

    // Os nacionais, com a decisão da clínica aplicada. Sem decisão, bloqueiam —
    // que é o certo para a maioria, e o oposto do que o Google Calendar faz.
    const feriados = feriadosNacionais(ano).map((f) => ({
        key: f.key,
        name: f.name,
        date: f.date,
        movel: f.movel,
        blocks: decisoes.get(f.key) ?? true,
        /** Se a clínica já disse alguma coisa sobre este, ou é o padrão. */
        decidido: decisoes.has(f.key),
    }))

    const fechamentos = linhas
        .filter((l) => !l.holidayKey && l.startsOn && l.endsOn)
        .map((l) => ({
            id: l.id,
            name: l.name,
            startsOn: (l.startsOn as Date).toISOString().slice(0, 10),
            endsOn: (l.endsOn as Date).toISOString().slice(0, 10),
            allDay: l.allDay,
            startTime: l.startTime,
            endTime: l.endTime,
            blocks: l.blocks,
        }))

    return NextResponse.json({ ano, feriados, fechamentos })
}

/** Cria um fechamento próprio da clínica. */
export async function POST(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (!hasEditorRole(auth.member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const parsed = entradaSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
            { status: 400 }
        )
    }
    const e = parsed.data

    try {
        const criado = await prisma.scheduleException.create({
            data: {
                workspaceId: auth.member.workspaceId,
                name: e.name,
                startsOn: new Date(`${e.startsOn}T00:00:00Z`),
                endsOn: new Date(`${e.endsOn}T00:00:00Z`),
                allDay: e.allDay,
                startTime: e.allDay ? null : e.startTime ?? null,
                endTime: e.allDay ? null : e.endTime ?? null,
                blocks: e.blocks,
            },
            select: { id: true },
        })
        return NextResponse.json(criado, { status: 201 })
    } catch (error) {
        console.error('[SCHEDULE_EXCEPTIONS_POST]', error)
        return NextResponse.json({ error: 'Não foi possível salvar o fechamento' }, { status: 500 })
    }
}

/**
 * A decisão da clínica sobre um feriado nacional.
 *
 * `PUT` e não `POST` porque é idempotente: há no máximo uma decisão por feriado
 * por clínica, e mandar duas vezes dá no mesmo.
 */
export async function PUT(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (!hasEditorRole(auth.member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as { holidayKey?: string; blocks?: boolean }
    const chave = typeof body.holidayKey === 'string' ? body.holidayKey : ''
    if (!chave) return NextResponse.json({ error: 'Feriado não informado' }, { status: 400 })

    const conhecido = feriadosNacionais(new Date().getFullYear()).find((f) => f.key === chave)
    if (!conhecido) return NextResponse.json({ error: 'Feriado desconhecido' }, { status: 404 })

    const blocks = body.blocks !== false

    /**
     * Sem `try`, esta rota devolvia 500 mudo e a tela dizia só "Não foi
     * possível salvar" — foi o que escondeu, por dias, um erro de banco que
     * dizia exatamente o que estava errado.
     *
     * O `upsert` do Prisma compila para `INSERT … ON CONFLICT
     * ("workspaceId","holidayKey")`, e isso exige um índice único **não
     * parcial** sobre essas duas colunas. O índice criado em
     * `20261014200000_agenda_specialists` era parcial, e o Postgres recusava a
     * inferência em toda marcação de feriado. Corrigido em
     * `20261018040000_feriado_unico_nao_parcial`.
     */
    try {
        await prisma.scheduleException.upsert({
            where: { workspaceId_holidayKey: { workspaceId: auth.member.workspaceId, holidayKey: chave } },
            create: {
                workspaceId: auth.member.workspaceId,
                holidayKey: chave,
                name: conhecido.name,
                blocks,
            },
            update: { blocks },
        })
    } catch (error) {
        console.error('[SCHEDULE_EXCEPTIONS_PUT]', error)
        return NextResponse.json({ error: 'Não foi possível salvar o feriado' }, { status: 500 })
    }

    return NextResponse.json({ holidayKey: chave, blocks })
}
