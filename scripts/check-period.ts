/**
 * As contas que erram calado.
 *
 * O projeto não tem suíte de testes, e esta é a parte do código onde um erro não
 * aparece na tela: a semana que começa num dia errado, fevereiro com 28 dias num
 * ano bissexto, o `toISOString()` que empurra o dia no fuso de São Paulo, e o
 * atendente que recebe o recorte de outra pessoa por pedir na URL.
 *
 * `npm run check:period`
 */
import { periodRange, matchPreset, resolvePeriodParams, isoDay } from '@/lib/period'
import { resolveOwnerScope, canSeeEveryone, conversationScope, type WorkspaceRole } from '@/lib/auth/workspace'

let fails = 0
function eq(label: string, got: unknown, want: unknown) {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) fails++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`)
}

// Três âncoras na mesma semana de outubro de 2026, para pegar as bordas do
// domingo: 11/10 é domingo, 10/10 é o sábado anterior, 14/10 é a quarta.
const sat = new Date(2026, 9, 10, 15, 0).getTime()   // sábado
const sun = new Date(2026, 9, 11, 15, 0).getTime()   // domingo
const wed = new Date(2026, 9, 14, 9, 30).getTime()   // quarta

console.log('— atalhos de período')
eq('Hoje é um dia só', periodRange('today', wed), { from: '2026-10-14', to: '2026-10-14' })
eq('Esta semana começa no domingo', periodRange('week', wed), { from: '2026-10-11', to: '2026-10-17' })
eq('No próprio domingo a semana começa nele', periodRange('week', sun), { from: '2026-10-11', to: '2026-10-17' })
eq('No sábado a semana é a que termina nele', periodRange('week', sat), { from: '2026-10-04', to: '2026-10-10' })
eq('Este mês vai do dia 1 ao último', periodRange('month', wed), { from: '2026-10-01', to: '2026-10-31' })
eq('Fevereiro de ano bissexto', periodRange('month', new Date(2028, 1, 10).getTime()), { from: '2028-02-01', to: '2028-02-29' })
eq('Últimos 7 dias incluem hoje', periodRange('d7', wed), { from: '2026-10-08', to: '2026-10-14' })
eq('Últimos 30 dias atravessam o mês', periodRange('d30', wed), { from: '2026-09-15', to: '2026-10-14' })
eq('Últimos 90 dias', periodRange('d90', wed), { from: '2026-07-17', to: '2026-10-14' })

console.log('\n— o rótulo reconhece o atalho de volta')
eq('mês', matchPreset('2026-10-01', '2026-10-31', wed), 'month')
eq('semana', matchPreset('2026-10-11', '2026-10-17', wed), 'week')
eq('intervalo digitado não é atalho', matchPreset('2026-10-03', '2026-10-09', wed), null)
eq('sem data não é atalho', matchPreset('', '', wed), null)

console.log('\n— o que a URL manda')
eq('sem nada, o padrão da tela', resolvePeriodParams({}, 'month', wed), { from: '2026-10-01', to: '2026-10-31', preset: 'month' })
eq('period=all é "todo o período"', resolvePeriodParams({ period: 'all' }, 'month', wed), { from: '', to: '', preset: null })
eq('datas na URL ganham do padrão', resolvePeriodParams({ from: '2026-01-01', to: '2026-01-31' }, 'month', wed), { from: '2026-01-01', to: '2026-01-31', preset: null })
eq('só o começo', resolvePeriodParams({ from: '2026-01-01' }, 'week', wed), { from: '2026-01-01', to: '', preset: null })
eq('padrão da Agenda é a semana', resolvePeriodParams({}, 'week', wed), { from: '2026-10-11', to: '2026-10-17', preset: 'week' })

// A dica que impede o rótulo de piscar: o recorte que veio da URL e por acaso
// é um atalho precisa ser reconhecido como tal, senão o botão mostra as datas.
eq('intervalo da URL que coincide com o mês', resolvePeriodParams({ from: '2026-10-01', to: '2026-10-31' }, 'week', wed), { from: '2026-10-01', to: '2026-10-31', preset: 'month' })

console.log('\n— isoDay não empurra o dia no fuso de São Paulo')
eq('meia-noite local', isoDay(new Date(2026, 9, 14, 0, 0, 0)), '2026-10-14')
eq('23h59 local', isoDay(new Date(2026, 9, 14, 23, 59, 59)), '2026-10-14')

console.log('\n— quem vê o quê')
const member = (role: WorkspaceRole, departmentIds: string[] = []) => ({
    membershipId: 'm', userId: 'eu', workspaceId: 'w', role, departmentIds, canTransfer: false,
})
for (const role of ['OWNER', 'ADMIN', 'GESTOR'] as WorkspaceRole[]) {
    eq(`${role} pode escolher`, canSeeEveryone(role), true)
    eq(`${role} pedindo todos`, resolveOwnerScope(member(role), 'all'), null)
    eq(`${role} sem pedir nada vê todos`, resolveOwnerScope(member(role), null), null)
    eq(`${role} pedindo outra pessoa`, resolveOwnerScope(member(role), 'outra'), 'outra')
}
eq('ATENDENTE não pode escolher', canSeeEveryone('ATENDENTE'), false)
eq('ATENDENTE pedindo todos recebe a si mesmo', resolveOwnerScope(member('ATENDENTE'), 'all'), 'eu')
eq('ATENDENTE pedindo outra pessoa recebe a si mesmo', resolveOwnerScope(member('ATENDENTE'), 'outra'), 'eu')
eq('ATENDENTE sem pedir nada recebe a si mesmo', resolveOwnerScope(member('ATENDENTE'), null), 'eu')

/**
 * O recorte de fila, que é a outra conta que erra calado.
 *
 * Um erro aqui não dá tela de erro: dá alguém vendo conversa que não é da fila
 * dele — ou, pior, **não** dando sintoma nenhum, porque errar para o lado de
 * mostrar demais ninguém reclama.
 *
 * `filaGeral` é o que todo mundo vê sempre: linha sem departamento e conversa
 * sem linha não são de ninguém em particular.
 */
console.log('\n— recorte de conversa por departamento')

const filaGeral = [
    { integration: { departmentId: null } },
    { integrationId: null },
]
const comFilas = (ids: string[]) => ({
    AND: [{ OR: [{ integration: { departmentId: { in: ids } } }, ...filaGeral] }],
})

for (const role of ['OWNER', 'ADMIN', 'GESTOR'] as WorkspaceRole[]) {
    eq(`${role} não é recortado`, conversationScope(member(role, ['comercial'])), {})
}

eq(
    'atendente vê as filas dos departamentos dele',
    conversationScope(member('ATENDENTE', ['comercial', 'recepcao'])),
    comFilas(['comercial', 'recepcao'])
)

// O fail-closed: `in []` não casa com nada, então sobra a fila geral. Antes
// este caso devolvia `{}` — "vê tudo" — e era o buraco: a clínica criava
// departamentos, esquecia de atribuir alguém, e essa pessoa seguia lendo todas
// as filas sem que nada apontasse para isso.
//
// É também a neutralização que dispensa um parâmetro de "usar departamentos":
// numa clínica sem departamento nenhum, toda linha tem `departmentId` nulo, e
// então esta mesma fórmula casa com todas as conversas.
eq(
    'atendente sem departamento fica com a fila geral, não com tudo',
    conversationScope(member('ATENDENTE', [])),
    comFilas([])
)

console.log(fails === 0 ? '\nTodos passaram.' : `\n${fails} falharam.`)
process.exit(fails === 0 ? 0 : 1)
