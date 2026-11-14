import { feriadosNacionais } from './holidays'

/**
 * Quando a clínica tem horário livre.
 *
 * Função **pura**: recebe tudo o que precisa e não vai ao banco. É deliberado —
 * este é o cálculo que decide se um paciente aparece na porta no horário certo,
 * e o único jeito de confiar nele é poder exercitá-lo com entradas montadas à
 * mão, sem subir servidor nem semear tabela.
 *
 * A conta, em ordem:
 *
 *   1. as janelas do especialista naquele dia da semana
 *   2. menos o que o calendário da clínica bloqueia (feriado, recesso)
 *   3. menos o que já está marcado para aquele especialista
 *   4. fatiado no tamanho do procedimento
 *
 * **Tudo em horário local da clínica.** As faixas são strings "HH:MM" e as datas
 * são "YYYY-MM-DD" — nunca `Date` com fuso, porque "terça das 14h" é 14h no
 * relógio da parede da clínica, e converter para UTC e voltar é o caminho mais
 * curto para marcar consulta uma hora errada no horário de verão.
 */

export interface Janela {
    weekday: number
    startTime: string
    endTime: string
    agentCanBook: boolean
    procedureIds: string[]
}

/** Um compromisso que já ocupa a agenda do especialista. */
export interface Ocupado {
    /** "YYYY-MM-DD" */
    date: string
    /** "HH:MM" */
    startTime: string
    /** Minutos. Quando desconhecida, quem chama decide um padrão. */
    durationMinutes: number
}

/** Feriado ou fechamento da clínica. */
export interface Excecao {
    /** "YYYY-MM-DD" */
    startsOn: string
    endsOn: string
    allDay: boolean
    startTime?: string | null
    endTime?: string | null
    /** `false` = "atendemos neste feriado", e aí ela não tira nada. */
    blocks: boolean
}

export interface Vaga {
    /** "YYYY-MM-DD" */
    date: string
    /** "HH:MM" */
    startTime: string
    endTime: string
}

/** "HH:MM" → minutos desde a meia-noite. */
export function emMinutos(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
}

/** Minutos desde a meia-noite → "HH:MM". */
export function emHora(minutos: number): string {
    const h = Math.floor(minutos / 60)
    const m = minutos % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** O dia da semana de "YYYY-MM-DD", 0 = domingo. Sem fuso: a data é literal. */
export function diaDaSemana(data: string): number {
    const [a, m, d] = data.split('-').map(Number)
    return new Date(Date.UTC(a, m - 1, d)).getUTCDay()
}

/** As datas de `de` até `ate`, inclusive, como "YYYY-MM-DD". */
export function diasEntre(de: string, ate: string): string[] {
    const dias: string[] = []
    const [a, m, d] = de.split('-').map(Number)
    const cursor = new Date(Date.UTC(a, m - 1, d))
    // Teto de um ano: um intervalo aberto por engano não pode virar laço infinito.
    for (let i = 0; i < 366; i++) {
        const iso = cursor.toISOString().slice(0, 10)
        if (iso > ate) break
        dias.push(iso)
        cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return dias
}

interface Intervalo {
    inicio: number
    fim: number
}

/** Tira de `base` tudo o que `cortes` cobre, devolvendo o que sobrou. */
function subtrair(base: Intervalo[], cortes: Intervalo[]): Intervalo[] {
    let restante = base
    for (const corte of cortes) {
        const proximo: Intervalo[] = []
        for (const faixa of restante) {
            // Sem interseção: a faixa passa inteira.
            if (corte.fim <= faixa.inicio || corte.inicio >= faixa.fim) {
                proximo.push(faixa)
                continue
            }
            if (corte.inicio > faixa.inicio) proximo.push({ inicio: faixa.inicio, fim: corte.inicio })
            if (corte.fim < faixa.fim) proximo.push({ inicio: corte.fim, fim: faixa.fim })
        }
        restante = proximo
    }
    return restante
}

/**
 * O que o calendário da clínica tira de um dia.
 *
 * Devolve `null` quando o dia inteiro está bloqueado, e a lista de recortes
 * quando o bloqueio é parcial. Uma exceção com `blocks: false` não tira nada —
 * ela existe para dizer "este feriado nós atendemos".
 */
function cortesDoDia(data: string, excecoes: Excecao[]): Intervalo[] | null {
    const cortes: Intervalo[] = []
    for (const e of excecoes) {
        if (!e.blocks) continue
        if (data < e.startsOn || data > e.endsOn) continue
        if (e.allDay || !e.startTime || !e.endTime) return null
        cortes.push({ inicio: emMinutos(e.startTime), fim: emMinutos(e.endTime) })
    }
    return cortes
}

export interface CalcularVagasInput {
    /** As janelas do especialista. */
    janelas: Janela[]
    /** O que já está marcado para ele. */
    ocupados: Ocupado[]
    /** Fechamentos e decisões sobre feriados, do banco. */
    excecoes: Excecao[]
    /** De quando até quando procurar, inclusive. "YYYY-MM-DD". */
    de: string
    ate: string
    /** Quanto tempo o procedimento ocupa. */
    duracaoMinutos: number
    /**
     * Só as janelas liberadas para o agente, e só as que aceitam este
     * procedimento. Quando ausente, considera todas as janelas — que é a visão
     * da recepção.
     */
    paraAgente?: { procedureId: string }
    /**
     * Nunca oferecer vaga antes deste instante. "YYYY-MM-DDTHH:MM" no relógio da
     * clínica. Sem ele, o cálculo ofereceria a terça de manhã numa terça à
     * tarde.
     */
    agora?: string
    /**
     * De quanto em quanto tempo as vagas começam. Trinta minutos dá horários
     * redondos; um procedimento de 50 minutos ainda ocupa 50.
     */
    passoMinutos?: number
    /** Feriados nacionais que a clínica não decidiu nada a respeito: bloqueiam. */
    feriadosBloqueiam?: boolean
}

export function calcularVagas(input: CalcularVagasInput): Vaga[] {
    const {
        janelas,
        ocupados,
        excecoes,
        de,
        ate,
        duracaoMinutos,
        paraAgente,
        agora,
        passoMinutos = 30,
        feriadosBloqueiam = true,
    } = input

    if (duracaoMinutos <= 0) return []

    /**
     * Os feriados nacionais que a clínica não mencionou.
     *
     * A lista é calculada (ver `holidays.ts`), e por padrão bloqueia. Uma linha
     * em `excecoes` com a mesma data manda — é assim que "neste nós atendemos"
     * vence o padrão.
     */
    const anos = new Set([de.slice(0, 4), ate.slice(0, 4)].map(Number))
    const decididos = new Set(excecoes.map((e) => e.startsOn))
    const feriados: Excecao[] = feriadosBloqueiam
        ? [...anos]
              .flatMap((ano) => feriadosNacionais(ano))
              .filter((f) => f.date >= de && f.date <= ate && !decididos.has(f.date))
              .map((f) => ({ startsOn: f.date, endsOn: f.date, allDay: true, blocks: true }))
        : []

    const todasExcecoes = [...excecoes, ...feriados]
    const vagas: Vaga[] = []

    for (const data of diasEntre(de, ate)) {
        const cortes = cortesDoDia(data, todasExcecoes)
        // Dia inteiro bloqueado: nem olha as janelas.
        if (cortes === null) continue

        const doDia = janelas.filter((j) => {
            if (j.weekday !== diaDaSemana(data)) return false
            if (!paraAgente) return true
            // Para o agente: só janela liberada, e só se ela aceita este
            // procedimento. Lista vazia significa nenhum, não todos.
            return j.agentCanBook && j.procedureIds.includes(paraAgente.procedureId)
        })
        if (doDia.length === 0) continue

        const marcados = ocupados
            .filter((o) => o.date === data)
            .map((o) => ({
                inicio: emMinutos(o.startTime),
                fim: emMinutos(o.startTime) + o.durationMinutes,
            }))

        // O passado não é vaga.
        const limite =
            agora && agora.slice(0, 10) === data ? emMinutos(agora.slice(11, 16)) : -1

        for (const janela of doDia) {
            const base: Intervalo[] = [
                { inicio: emMinutos(janela.startTime), fim: emMinutos(janela.endTime) },
            ]
            const livres = subtrair(base, [...cortes, ...marcados])

            for (const faixa of livres) {
                // Começa num múltiplo do passo, para os horários saírem redondos.
                let inicio = Math.ceil(faixa.inicio / passoMinutos) * passoMinutos
                if (inicio < faixa.inicio) inicio = faixa.inicio
                for (; inicio + duracaoMinutos <= faixa.fim; inicio += passoMinutos) {
                    if (inicio <= limite) continue
                    vagas.push({
                        date: data,
                        startTime: emHora(inicio),
                        endTime: emHora(inicio + duracaoMinutos),
                    })
                }
            }
        }
    }

    // Em ordem cronológica: a primeira da lista é a que se oferece primeiro.
    return vagas.sort((a, b) =>
        a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)
    )
}
