/**
 * Os casos do cálculo de disponibilidade.
 *
 *   npm run test:availability
 *
 * `calcularVagas` é função pura de propósito, e é por isso que estes casos
 * existem: é o cálculo que decide se um paciente aparece na porta no horário
 * certo, e dá para exercitá-lo inteiro com entradas montadas à mão, sem subir
 * servidor nem semear tabela.
 *
 * As datas são reais e verificadas: 20/10/2026 é terça, 25/12/2026 é sexta, e a
 * Sexta-feira Santa de 2026 cai em 03/04 — esta última calculada pela Páscoa,
 * que é o caso que um cadastro de feriado "anual em data fixa" erraria.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { calcularVagas, diaDaSemana, type Janela, type Ocupado, type Excecao } from '@venn/core/lib/availability'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) { passou++; console.log(`  ok  ${nome}`) }
    else { falhou++; console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`) }
}

// 2026-10-20 é uma terça-feira. Confirmando a premissa dos casos.
conferir('20/10/2026 é terça (2)', diaDaSemana('2026-10-20'), 2)

const terca: Janela = {
    weekday: 2, startTime: '14:00', endTime: '17:00',
    agentCanBook: true, procedureIds: ['avaliacao'],
}

const base = {
    janelas: [terca], ocupados: [] as Ocupado[], excecoes: [] as Excecao[],
    de: '2026-10-20', ate: '2026-10-20', duracaoMinutos: 30,
}

console.log('\n── a janela vazia ──')
conferir('14–17 em fatias de 30 dá 6 vagas',
    calcularVagas(base).map((v) => v.startTime),
    ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30'])

conferir('procedimento de 60 min dá 5 começos, e o último termina às 17h',
    calcularVagas({ ...base, duracaoMinutos: 60 }).map((v) => `${v.startTime}-${v.endTime}`),
    ['14:00-15:00', '14:30-15:30', '15:00-16:00', '15:30-16:30', '16:00-17:00'])

conferir('procedimento que não cabe não gera vaga',
    calcularVagas({ ...base, duracaoMinutos: 240 }), [])

console.log('\n── o que já está marcado ──')
conferir('consulta das 15h às 15h30 tira as vagas que a cruzam',
    calcularVagas({ ...base, ocupados: [{ date: '2026-10-20', startTime: '15:00', durationMinutes: 30 }] })
        .map((v) => v.startTime),
    ['14:00', '14:30', '15:30', '16:00', '16:30'])

conferir('consulta de 2h no meio parte a janela em duas',
    calcularVagas({ ...base, ocupados: [{ date: '2026-10-20', startTime: '14:30', durationMinutes: 120 }] })
        .map((v) => v.startTime),
    ['14:00', '16:30'])

console.log('\n── o calendário da clínica ──')
conferir('fechamento de dia inteiro zera o dia',
    calcularVagas({ ...base, excecoes: [{ startsOn: '2026-10-20', endsOn: '2026-10-20', allDay: true, blocks: true }] }),
    [])

conferir('fechamento parcial das 15h às 16h recorta só aquilo',
    calcularVagas({ ...base, excecoes: [{ startsOn: '2026-10-20', endsOn: '2026-10-20', allDay: false, startTime: '15:00', endTime: '16:00', blocks: true }] })
        .map((v) => v.startTime),
    ['14:00', '14:30', '16:00', '16:30'])

conferir('recesso que cobre o dia, declarado como intervalo, zera',
    calcularVagas({ ...base, excecoes: [{ startsOn: '2026-10-19', endsOn: '2026-10-23', allDay: true, blocks: true }] }),
    [])

conferir('exceção com blocks:false não tira nada',
    calcularVagas({ ...base, excecoes: [{ startsOn: '2026-10-20', endsOn: '2026-10-20', allDay: true, blocks: false }] }).length,
    6)

console.log('\n── os feriados nacionais ──')
// 2026-12-25 é uma sexta-feira. Natal.
const sexta: Janela = { ...terca, weekday: 5 }
const natal = { ...base, janelas: [sexta], de: '2026-12-25', ate: '2026-12-25' }
conferir('25/12 é sexta (5)', diaDaSemana('2026-12-25'), 5)
conferir('o Natal bloqueia sozinho, sem ninguém cadastrar', calcularVagas(natal), [])
conferir('a clínica que atende no Natal decide e o dia volta',
    calcularVagas({ ...natal, excecoes: [{ startsOn: '2026-12-25', endsOn: '2026-12-25', allDay: true, blocks: false }] }).length,
    6)

// Sexta-feira Santa de 2026: 03/04, calculada pela Páscoa.
const santa = { ...base, janelas: [sexta], de: '2026-04-03', ate: '2026-04-03' }
conferir('03/04/2026 é sexta (5)', diaDaSemana('2026-04-03'), 5)
conferir('a Sexta-feira Santa móvel bloqueia sozinha', calcularVagas(santa), [])

console.log('\n── o recorte do agente ──')
const soRecepcao: Janela = { ...terca, agentCanBook: false }
conferir('janela não liberada: a recepção vê, o agente não',
    calcularVagas({ ...base, janelas: [soRecepcao], paraAgente: { procedureId: 'avaliacao' } }), [])
conferir('janela liberada mas sem o procedimento na lista: o agente não marca',
    calcularVagas({ ...base, paraAgente: { procedureId: 'implante' } }), [])
conferir('janela liberada com o procedimento: o agente marca',
    calcularVagas({ ...base, paraAgente: { procedureId: 'avaliacao' } }).length, 6)
conferir('lista de procedimentos vazia significa nenhum, não todos',
    calcularVagas({ ...base, janelas: [{ ...terca, procedureIds: [] }], paraAgente: { procedureId: 'avaliacao' } }), [])

console.log('\n── o passado ──')
conferir('às 15h20 de hoje, só sobram as de 15h30 em diante',
    calcularVagas({ ...base, agora: '2026-10-20T15:20' }).map((v) => v.startTime),
    ['15:30', '16:00', '16:30'])
conferir('o corte do "agora" não afeta outro dia',
    calcularVagas({ ...base, ate: '2026-10-27', agora: '2026-10-20T16:50' }).map((v) => `${v.date} ${v.startTime}`),
    ['2026-10-27 14:00', '2026-10-27 14:30', '2026-10-27 15:00', '2026-10-27 15:30', '2026-10-27 16:00', '2026-10-27 16:30'])

console.log('\n── bordas ──')
conferir('duração zero não devolve nada', calcularVagas({ ...base, duracaoMinutos: 0 }), [])
conferir('sem janela no dia da semana, nada',
    calcularVagas({ ...base, janelas: [{ ...terca, weekday: 3 }] }), [])
conferir('duas janelas no mesmo dia somam',
    calcularVagas({ ...base, janelas: [terca, { ...terca, startTime: '09:00', endTime: '10:00' }] }).map((v) => v.startTime),
    ['09:00', '09:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'])

console.log(`\n${passou} passaram, ${falhou} falharam`)
process.exit(falhou === 0 ? 0 : 1)
