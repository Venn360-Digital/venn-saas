/**
 * Os feriados nacionais brasileiros, calculados — não cadastrados.
 *
 * **Por que não ficam no banco.** Carnaval, Sexta-feira Santa e Corpus Christi
 * andam com a Páscoa, que muda de data todo ano. Gravados como "anual em data
 * fixa" estariam errados já no ano seguinte, e ninguém perceberia até o agente
 * marcar consulta na Sexta-feira Santa. A Páscoa se calcula; então a lista é
 * código, e o banco guarda só o que é decisão da clínica — ver
 * `ScheduleException`.
 *
 * O que a clínica acrescenta (feriado municipal, recesso, dedetização) é
 * cadastro dela e mora no banco. Esta lista é só o que vale para o país inteiro.
 */

export interface Holiday {
    /** Estável entre anos: é por ela que a clínica diz "neste nós atendemos". */
    key: string
    name: string
    /** `YYYY-MM-DD` no calendário civil brasileiro. */
    date: string
    /** Se a data se move com a Páscoa — útil para a tela explicar. */
    movel: boolean
}

/**
 * O domingo de Páscoa, pelo algoritmo de Meeus/Jones/Butcher.
 *
 * Vale para todo o calendário gregoriano. Devolve mês (1-12) e dia.
 */
function pascoa(ano: number): { mes: number; dia: number } {
    const a = ano % 19
    const b = Math.floor(ano / 100)
    const c = ano % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const mes = Math.floor((h + l - 7 * m + 114) / 31)
    const dia = ((h + l - 7 * m + 114) % 31) + 1
    return { mes, dia }
}

/** `YYYY-MM-DD` de uma data deslocada em dias a partir de outra. */
function desloca(ano: number, mes: number, dia: number, dias: number): string {
    const d = new Date(Date.UTC(ano, mes - 1, dia))
    d.setUTCDate(d.getUTCDate() + dias)
    return d.toISOString().slice(0, 10)
}

const FIXOS: { key: string; name: string; mes: number; dia: number }[] = [
    { key: 'confraternizacao', name: 'Confraternização Universal', mes: 1, dia: 1 },
    { key: 'tiradentes', name: 'Tiradentes', mes: 4, dia: 21 },
    { key: 'trabalho', name: 'Dia do Trabalho', mes: 5, dia: 1 },
    { key: 'independencia', name: 'Independência do Brasil', mes: 9, dia: 7 },
    { key: 'aparecida', name: 'Nossa Senhora Aparecida', mes: 10, dia: 12 },
    { key: 'finados', name: 'Finados', mes: 11, dia: 2 },
    { key: 'republica', name: 'Proclamação da República', mes: 11, dia: 15 },
    // Feriado nacional desde a Lei 14.759/2023.
    { key: 'consciencia-negra', name: 'Consciência Negra', mes: 11, dia: 20 },
    { key: 'natal', name: 'Natal', mes: 12, dia: 25 },
]

/** Os feriados nacionais de um ano, em ordem de data. */
export function feriadosNacionais(ano: number): Holiday[] {
    const { mes, dia } = pascoa(ano)

    const moveis: Holiday[] = [
        { key: 'carnaval', name: 'Carnaval', date: desloca(ano, mes, dia, -47), movel: true },
        { key: 'sexta-santa', name: 'Sexta-feira Santa', date: desloca(ano, mes, dia, -2), movel: true },
        { key: 'corpus-christi', name: 'Corpus Christi', date: desloca(ano, mes, dia, 60), movel: true },
    ]

    const fixos: Holiday[] = FIXOS.map((f) => ({
        key: f.key,
        name: f.name,
        date: `${ano}-${String(f.mes).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`,
        movel: false,
    }))

    return [...fixos, ...moveis].sort((a, b) => a.date.localeCompare(b.date))
}

/** O feriado nacional que cai nesta data, se houver. `data` em `YYYY-MM-DD`. */
export function feriadoEm(data: string): Holiday | undefined {
    const ano = Number(data.slice(0, 4))
    if (!Number.isFinite(ano)) return undefined
    return feriadosNacionais(ano).find((f) => f.date === data)
}
