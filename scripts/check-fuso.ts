/**
 * Prova do fuso do negócio.
 *
 * Existe porque este é o tipo de erro que não aparece em teste manual: só se
 * manifesta nas três horas entre 21h e meia-noite de Brasília, e o resultado
 * errado é plausível — uma atividade "atrasada" não parece um defeito.
 *
 * Foi assim que passou despercebido na migração: a VPS rodava com
 * `TZ=America/Sao_Paulo` e o Cloudflare Workers **ignora `TZ`**. Medido em
 * 2026-10-22, às 22:17 de Brasília, o painel contava uma atividade que vencia
 * às 10h **daquele mesmo dia** como atrasada.
 *
 * Puro de propósito: nenhuma IO, e independe do fuso da máquina que roda o
 * teste — é justamente isso que as funções garantem.
 */
import {
    anoNoFuso,
    diaDaSemana,
    diaDaSemanaNoFuso,
    diaDeDataSemHora,
    diaNoFuso,
    fimDoDia,
    horaMinutoNoFuso,
    horaNoFuso,
    inicioDoDia,
    inicioDoDiaUtc,
    instanteNoFuso,
    limitesDoMes,
    somarDias,
} from '@venn/core/lib/fuso'
import { periodRange } from '@venn/core/lib/period'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

function main() {
    // O instante exato do diagnóstico: 01:17 UTC do dia 23, que no Brasil ainda
    // é dia 22 às 22:17. É a janela em que o erro aparecia.
    const aNoite = new Date('2026-10-23T01:17:00Z')

    ok('a noite brasileira ainda é o dia anterior', diaNoFuso(aNoite) === '2026-10-22', diaNoFuso(aNoite))
    ok('de manhã o dia bate com o UTC', diaNoFuso(new Date('2026-10-22T13:00:00Z')) === '2026-10-22')

    // Meia-noite em Brasília é 03:00 UTC (sem horário de verão desde 2019).
    ok(
        'início do dia é 03:00 UTC',
        inicioDoDia('2026-10-22').toISOString() === '2026-10-22T03:00:00.000Z',
        inicioDoDia('2026-10-22').toISOString()
    )
    ok(
        'fim do dia é 03:00 UTC do dia seguinte',
        fimDoDia('2026-10-22').toISOString() === '2026-10-23T03:00:00.000Z',
        fimDoDia('2026-10-22').toISOString()
    )

    // O caso que estava errado em produção: 10:00 de Brasília do dia 22
    // (13:00 UTC) tem de cair DENTRO do dia 22, olhando às 22:17 daquele dia.
    const vencimento = new Date('2026-10-22T13:00:00Z')
    const hoje = diaNoFuso(aNoite)
    const dentro = vencimento >= inicioDoDia(hoje) && vencimento < fimDoDia(hoje)
    ok('atividade das 10h conta como HOJE, não como atrasada', dentro)

    // E o contrário: 23:30 de Brasília do dia 22 (02:30 UTC do 23) também é
    // do dia 22 — é o outro lado da mesma fronteira.
    const tarde = new Date('2026-10-23T02:30:00Z')
    ok('23h30 ainda é o mesmo dia', diaNoFuso(tarde) === '2026-10-22')

    // --------------------------------------------------------- calendário
    ok('somar dias atravessa o mês', somarDias('2026-10-31', 1) === '2026-11-01')
    ok('somar dias para trás', somarDias('2026-11-01', -1) === '2026-10-31')
    ok('somar dias atravessa o ano', somarDias('2026-12-31', 1) === '2027-01-01')
    ok('ano bissexto', somarDias('2028-02-28', 1) === '2028-02-29')

    ok('22/10/2026 é quinta', diaDaSemana('2026-10-22') === 4)
    ok('domingo é zero', diaDaSemana('2026-10-18') === 0)

    const mes = limitesDoMes('2026-10-22')
    ok('mês começa no dia 1', mes.primeiro === '2026-10-01')
    ok('outubro termina no 31', mes.ultimo === '2026-10-31')
    ok('fevereiro bissexto termina no 29', limitesDoMes('2028-02-10').ultimo === '2028-02-29')

    // ------------------------------------------------- os atalhos da tela
    const agora = aNoite.getTime()
    const hojeRange = periodRange('today', agora)
    ok('atalho "Hoje" usa o dia brasileiro', hojeRange.from === '2026-10-22' && hojeRange.to === '2026-10-22', `${hojeRange.from}..${hojeRange.to}`)

    const semana = periodRange('week', agora)
    ok('semana começa no domingo', semana.from === '2026-10-18' && semana.to === '2026-10-24', `${semana.from}..${semana.to}`)

    const mesRange = periodRange('month', agora)
    ok('mês vai do 1 ao 31', mesRange.from === '2026-10-01' && mesRange.to === '2026-10-31')

    const d7 = periodRange('d7', agora)
    ok('últimos 7 dias incluem hoje', d7.to === '2026-10-22' && d7.from === '2026-10-16', `${d7.from}..${d7.to}`)

    // ------------------------------------------- hora de parede da clínica
    ok(
        '14:30 da clínica é 17:30 UTC',
        instanteNoFuso('2026-10-22', '14:30').toISOString() === '2026-10-22T17:30:00.000Z',
        instanteNoFuso('2026-10-22', '14:30').toISOString()
    )
    ok('e a volta devolve 14:30', horaMinutoNoFuso(new Date('2026-10-22T17:30:00Z')) === '14:30')
    ok('a hora da noite é 22, não 1', horaNoFuso(aNoite) === 22, String(horaNoFuso(aNoite)))
    ok('o ano na virada ainda é o anterior', anoNoFuso(new Date('2027-01-01T02:00:00Z')) === 2026)
    ok('o dia da semana é o brasileiro', diaDaSemanaNoFuso(aNoite) === 4)

    // ------------------------------------ as DUAS fronteiras, e por que há duas
    //
    // Esta é a parte que mais fácil regride: trocar uma pela outra não quebra
    // nada visível, só some com os compromissos do dia ou conta o dia errado.
    const hojeBr = diaNoFuso(aNoite) // 2026-10-22, às 22h17 de Brasília

    // `dueDate` é data sem hora: a rota grava `new Date('2026-10-22')`, que é
    // meia-noite UTC. A fronteira tem de ser UTC, senão ele fica de fora.
    const compromisso = new Date('2026-10-22T00:00:00Z')
    ok('compromisso do dia cai dentro da fronteira UTC',
        compromisso >= inicioDoDiaUtc(hojeBr) && compromisso < inicioDoDiaUtc(somarDias(hojeBr, 1)))
    ok('e ficaria de fora da fronteira de Brasília — por isso há duas',
        !(compromisso >= inicioDoDia(hojeBr) && compromisso < fimDoDia(hojeBr)))

    // Coluna de instante (`createdAt`): aí sim o dia é o de Brasília.
    const criadoAsDez = new Date('2026-10-22T13:00:00Z') // 10h em Brasília
    ok('instante das 10h cai no dia de Brasília',
        criadoAsDez >= inicioDoDia(hojeBr) && criadoAsDez < fimDoDia(hojeBr))

    ok('data sem hora devolve o próprio dia', diaDeDataSemHora(compromisso) === '2026-10-22')

    console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
}

main()
