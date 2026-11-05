/**
 * Provas do fuso por unidade — a parte pura.
 *
 * O fuso decide que dia é hoje, quando o briefing sai e que instante vai para
 * a agenda do cliente. Errar aqui é silencioso: ninguém vê uma exceção, vê um
 * horário estranho semanas depois. Então as conversões são provadas contra
 * valores conferidos à mão, e não só contra elas mesmas.
 *
 *     npm run test:fuso-unidade
 */
import {
    FUSO_DO_NEGOCIO,
    diaNoFuso,
    horaNoFuso,
    horaMinutoNoFuso,
    instanteNoFuso,
    inicioDoDia,
} from '../src/lib/fuso'
import {
    comFusoNasConfiguracoes,
    lerFusoDasConfiguracoes,
    temFusoNasConfiguracoes,
} from '../src/lib/fuso-da-unidade'
import { FUSO_INICIAL } from '../src/lib/onboarding/padroes'

let passou = 0
let falhou = 0

function conferir(nome: string, obtido: unknown, esperado: unknown) {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
    console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
    if (!ok) {
        console.log(`        esperado: ${JSON.stringify(esperado)}`)
        console.log(`        obtido:   ${JSON.stringify(obtido)}`)
        falhou++
    } else {
        passou++
    }
}

const SP = 'America/Sao_Paulo'
const SYD = 'Australia/Sydney'
const MAO = 'America/Manaus'

console.log('\nO padrão preserva o comportamento de antes')
// 2026-11-04T23:30Z = 20:30 em São Paulo do MESMO dia; 10:30 do dia 5 em Sydney.
const noite = new Date('2026-11-04T23:30:00.000Z')
conferir('sem fuso = fuso do negócio', diaNoFuso(noite), diaNoFuso(noite, FUSO_DO_NEGOCIO))
conferir('e o fuso do negócio é São Paulo', FUSO_DO_NEGOCIO, SP)
conferir('dia em São Paulo', diaNoFuso(noite, SP), '2026-11-04')
conferir('hora em São Paulo', horaNoFuso(noite, SP), 20)

console.log('\nO mesmo instante, lido por unidades em fusos diferentes')
conferir('em Sydney já é o dia seguinte', diaNoFuso(noite, SYD), '2026-11-05')
conferir('e são 10h da manhã lá', horaNoFuso(noite, SYD), 10)
conferir('Manaus é uma hora atrás de São Paulo', horaNoFuso(noite, MAO), 19)
conferir('mas no mesmo dia', diaNoFuso(noite, MAO), '2026-11-04')

console.log('\nHora de parede → instante, que é o que vai para a agenda')
// 09:00 em Sydney, em novembro (horário de verão, GMT+11) = 22:00Z do dia anterior.
conferir(
    '9h em Sydney é 22:00Z do dia anterior',
    instanteNoFuso('2026-11-10', '09:00', SYD).toISOString(),
    '2026-11-09T22:00:00.000Z'
)
conferir(
    '9h em São Paulo é 12:00Z',
    instanteNoFuso('2026-11-10', '09:00', SP).toISOString(),
    '2026-11-10T12:00:00.000Z'
)
conferir(
    'e a volta fecha o ciclo',
    horaMinutoNoFuso(instanteNoFuso('2026-11-10', '09:00', SYD), SYD),
    '09:00'
)
conferir(
    'meia-noite em Sydney não é meia-noite em São Paulo',
    inicioDoDia('2026-11-10', SYD).toISOString(),
    '2026-11-09T13:00:00.000Z'
)

console.log('\nHorário de verão — o caso que uma conta à mão erraria')
// Sydney entra no verão em outubro: +11. Em julho é +10.
const julho = new Date('2026-07-01T00:00:00.000Z')
const janeiro = new Date('2026-01-01T00:00:00.000Z')
conferir('inverno austral: +10', horaNoFuso(julho, SYD), 10)
conferir('verão austral: +11', horaNoFuso(janeiro, SYD), 11)

console.log('\nLer e gravar em Workspace.settings')
conferir('settings nulo cai no padrão', lerFusoDasConfiguracoes(null), SP)
conferir('array cai no padrão', lerFusoDasConfiguracoes([1, 2]), SP)
conferir('fuso desconhecido cai no padrão', lerFusoDasConfiguracoes({ fusoHorario: 'Marte/Olympus' }), SP)
conferir('fuso conhecido é devolvido', lerFusoDasConfiguracoes({ fusoHorario: SYD }), SYD)
conferir(
    'gravar preserva o que já estava em settings',
    comFusoNasConfiguracoes({ tema: 'escuro' }, SYD),
    { tema: 'escuro', fusoHorario: SYD }
)
conferir(
    'gravar fuso inválido não suja settings',
    comFusoNasConfiguracoes({ tema: 'escuro' }, 'Marte/Olympus'),
    { tema: 'escuro' }
)
conferir(
    'trocar o fuso substitui, não acumula',
    comFusoNasConfiguracoes({ fusoHorario: SP }, SYD),
    { fusoHorario: SYD }
)

console.log('\nDeclarado ≠ caindo no padrão')
// O cadastro grava o fuso na conta que nasce, e a segunda chamada da rota não
// pode desfazer escolha de ninguém. Quem separa os dois casos é esta função —
// `lerFusoDasConfiguracoes` devolve São Paulo nos dois.
conferir('settings nulo: não declarou', temFusoNasConfiguracoes(null), false)
conferir('settings sem a chave: não declarou', temFusoNasConfiguracoes({ tema: 'escuro' }), false)
conferir('fuso inválido: não declarou', temFusoNasConfiguracoes({ fusoHorario: 'Marte/Olympus' }), false)
conferir('São Paulo escrito: declarou', temFusoNasConfiguracoes({ fusoHorario: SP }), true)
conferir('Sydney escrito: declarou', temFusoNasConfiguracoes({ fusoHorario: SYD }), true)

console.log('\nO fuso com que toda conta nasce')
// Pedido explícito do Andre: São Paulo no cadastro, nos três apps. Fica provado
// aqui para que "simplificar" a constante para o fallback quebre o teste em vez
// de passar calado.
conferir('o cadastro nasce em São Paulo', FUSO_INICIAL, SP)
conferir('e nasce declarado, não herdado', temFusoNasConfiguracoes(comFusoNasConfiguracoes(null, FUSO_INICIAL)), true)
conferir(
    'a conta que nasce preserva o que já houver em settings',
    comFusoNasConfiguracoes({ tema: 'escuro' }, FUSO_INICIAL),
    { tema: 'escuro', fusoHorario: SP }
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
