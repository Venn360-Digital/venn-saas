import prisma from '@venn/db/cliente'
import { vocab } from './vocabulario'
import { SCHEDULABLE_CATEGORIES } from './product-categories'
import {
    calcularVagas,
    type Excecao,
    type Janela,
    type Ocupado,
    type Vaga,
} from './availability'

/**
 * Busca no banco o que `calcularVagas` precisa, e chama o cálculo.
 *
 * A separação é de propósito: o cálculo é puro e testável
 * (`npm run test:availability`), e esta camada só sabe ler tabela. Misturar os
 * dois tornaria impossível exercitar o caso do feriado móvel sem semear banco.
 */

/** Minutos reservados quando o compromisso não aponta para um servico. */
const DURACAO_PADRAO = 30

export interface VagasInput {
    workspaceId: string
    professionalId: string
    /** O Item (servico) que se quer marcar. */
    procedureId: string
    de: string
    ate: string
    /** Quando presente, só janelas liberadas para a IA que aceitem este item. */
    paraAgente?: boolean
    /** "YYYY-MM-DDTHH:MM" no relógio da clínica. */
    agora?: string
}

export type VagasResultado =
    | { ok: true; vagas: Vaga[]; servico: { name: string; durationMinutes: number } }
    | { ok: false; motivo: string }

export async function buscarVagas(input: VagasInput): Promise<VagasResultado> {
    const { workspaceId, professionalId, procedureId, de, ate, paraAgente, agora } = input

    const [profissional, servico] = await Promise.all([
        prisma.professional.findFirst({
            where: { id: professionalId, workspaceId, isActive: true },
            include: { windows: { include: { services: true } } },
        }),
        prisma.productService.findFirst({
            where: { id: procedureId, workspaceId, category: { in: SCHEDULABLE_CATEGORIES } },
            select: { name: true, durationMinutes: true },
        }),
    ])

    if (!profissional) return { ok: false, motivo: `${vocab().Profissional} não encontrado ou inativo.` }
    if (!servico) return { ok: false, motivo: `${vocab().Servico} não encontrado.` }
    if (!servico.durationMinutes) {
        return {
            ok: false,
            motivo: `"${servico.name}" não tem duração cadastrada, então não dá para reservar o tempo dele.`,
        }
    }

    const janelas: Janela[] = profissional.windows.map((w) => ({
        weekday: w.weekday,
        startTime: w.startTime,
        endTime: w.endTime,
        agentCanBook: w.agentCanBook,
        procedureIds: w.services.map((p) => p.productServiceId),
    }))

    if (janelas.length === 0) {
        return { ok: false, motivo: `${profissional.name} ainda não tem horários cadastrados.` }
    }

    /**
     * O que já ocupa a agenda dele no período.
     *
     * Só os compromissos **deste profissional**: a agenda de uma doutora não é
     * afetada pelo que outra tem marcado.
     */
    const inicio = new Date(`${de}T00:00:00`)
    const fim = new Date(`${ate}T23:59:59`)
    const compromissos = await prisma.activity.findMany({
        where: {
            workspaceId,
            professionalId,
            completedAt: null,
            dueDate: { gte: inicio, lte: fim },
        },
        select: {
            dueDate: true,
            startTime: true,
            productService: { select: { durationMinutes: true } },
        },
    })

    const ocupados: Ocupado[] = compromissos
        .filter((c) => c.dueDate && c.startTime)
        .map((c) => ({
            // A data local do compromisso, como ela foi gravada.
            date: (c.dueDate as Date).toISOString().slice(0, 10),
            startTime: c.startTime as string,
            durationMinutes: c.productService?.durationMinutes ?? DURACAO_PADRAO,
        }))

    const linhas = await prisma.scheduleException.findMany({
        where: { workspaceId, OR: [{ startsOn: { not: null } }, { holidayKey: { not: null } }] },
    })

    /**
     * As decisões sobre feriado nacional viram exceção na data daquele ano.
     *
     * A linha guarda só a chave e o `blocks`; a data vem do cálculo, porque os
     * feriados móveis andam. Ver `holidays.ts`.
     */
    const { feriadosNacionais } = await import('./holidays')
    const anos = [...new Set([Number(de.slice(0, 4)), Number(ate.slice(0, 4))])]
    const porChave = new Map(
        anos.flatMap((ano) => feriadosNacionais(ano)).map((f) => [f.key, f.date])
    )

    const excecoes: Excecao[] = linhas.flatMap((l): Excecao[] => {
        if (l.holidayKey) {
            const data = porChave.get(l.holidayKey)
            if (!data) return []
            return [{ startsOn: data, endsOn: data, allDay: true, blocks: l.blocks }]
        }
        if (!l.startsOn || !l.endsOn) return []
        return [
            {
                startsOn: l.startsOn.toISOString().slice(0, 10),
                endsOn: l.endsOn.toISOString().slice(0, 10),
                allDay: l.allDay,
                startTime: l.startTime,
                endTime: l.endTime,
                blocks: l.blocks,
            },
        ]
    })

    const vagas = calcularVagas({
        janelas,
        ocupados,
        excecoes,
        de,
        ate,
        duracaoMinutos: servico.durationMinutes,
        ...(paraAgente ? { paraAgente: { procedureId } } : {}),
        ...(agora ? { agora } : {}),
    })

    return {
        ok: true,
        vagas,
        servico: { name: servico.name, durationMinutes: servico.durationMinutes },
    }
}
