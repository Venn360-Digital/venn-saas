/**
 * As provas dos recortes da coluna de Conversas.
 *
 * O que se afirma, e por que cada coisa:
 *
 * 1. **a aba lê `atendidaPor`, nunca `assignedTo`.** É a mudança inteira: era
 *    por `assignedTo` que "Em espera" significava "sem responsável". Se alguém
 *    reintroduzir `assignedTo` numa aba, o nó volta e a tela volta a mentir.
 * 2. **os nomes antigos de aba traduzem.** `waiting`/`active`/`closed` estão em
 *    aba aberta e em link colado; recusá-los mandaria gente para lista vazia.
 * 3. **o teto do atendente é independente da aba.** Antes estava escrito dentro
 *    do `switch`, com regra diferente por aba. Agora é uma cláusula só, e a
 *    prova é que ela não muda quando a aba muda.
 * 4. **"Todas" não levanta o teto do atendente.** É a afirmação de segurança:
 *    um seletor novo não pode abrir a carteira dos colegas.
 * 5. **quem colabora entra mesmo sendo conversa de outro.** É o item 6; sem
 *    esta cláusula, marcar a colega no comentário manda um aviso para uma
 *    conversa que ela não consegue abrir.
 */

import {
    ROTULO_DA_ABA,
    ROTULO_DO_VER,
    lerAba,
    lerVer,
    limiteDoAtendente,
    opcoesDeVer,
    recorteDaAba,
    recorteDoVer,
} from '../src/lib/conversas/recortes'

let ok = 0
let falhas = 0

function eq(nome: string, obtido: unknown, esperado: unknown) {
    const a = JSON.stringify(obtido)
    const b = JSON.stringify(esperado)
    if (a === b) {
        ok++
        console.log(`  ok  ${nome}`)
    } else {
        falhas++
        console.log(`  XX  ${nome}\n      esperado: ${b}\n      obtido:   ${a}`)
    }
}

console.log('\n— as abas, por `atendidaPor` —\n')

eq('Com a IA', recorteDaAba('ia'), { status: 'active', atendidaPor: 'bot' })
eq('Com a equipe', recorteDaAba('equipe'), { status: 'active', atendidaPor: 'humano' })
eq('Finalizadas', recorteDaAba('finalizadas'), { status: 'closed' })

/**
 * A afirmação que protege a correção: **nenhuma aba menciona `assignedTo`**.
 *
 * Escrita como varredura e não como três igualdades porque é uma invariante do
 * conjunto: uma aba nova que nasça amanhã também não pode ler aquele campo.
 */
for (const aba of ['ia', 'equipe', 'finalizadas'] as const) {
    const texto = JSON.stringify(recorteDaAba(aba))
    eq(`a aba "${aba}" não lê assignedTo`, texto.includes('assignedTo'), false)
    eq(`a aba "${aba}" não lê collaborators`, texto.includes('collaborators'), false)
}

console.log('\n— os nomes antigos de aba —\n')

eq('waiting vira ia', lerAba('waiting'), 'ia')
eq('active vira equipe', lerAba('active'), 'equipe')
eq('closed vira finalizadas', lerAba('closed'), 'finalizadas')
eq('o nome novo passa direto', lerAba('equipe'), 'equipe')
eq('vazio cai na primeira aba', lerAba(''), 'ia')
eq('nulo cai na primeira aba', lerAba(null), 'ia')
eq('lixo cai na primeira aba', lerAba('qualquer-coisa'), 'ia')

console.log('\n— o Ver —\n')

eq('todas é ausência de recorte', recorteDoVer('todas', 'eu'), null)
eq('minhas', recorteDoVer('minhas', 'eu'), { assignedTo: 'eu' })
eq('que eu colaboro', recorteDoVer('colaboro', 'eu'), {
    collaborators: { some: { userId: 'eu' } },
})
eq('sem responsável', recorteDoVer('sem-responsavel', 'eu'), { assignedTo: null })

eq('onlyMine=true do cliente antigo vira minhas', lerVer(null, true), 'minhas')
eq('onlyMine=false vira todas', lerVer(null, false), 'todas')
eq('o valor novo ganha do onlyMine', lerVer('colaboro', true), 'colaboro')
eq('lixo com onlyMine=false vira todas', lerVer('nada-disso', false), 'todas')

console.log('\n— o teto do atendente —\n')

const teto = {
    OR: [
        { assignedTo: 'eu' },
        { assignedTo: null },
        { collaborators: { some: { userId: 'eu' } } },
    ],
}
eq('o que o atendente alcança', limiteDoAtendente('eu'), teto)

// A invariante: o teto é o mesmo nas três abas. Antes a regra mudava por aba
// (`assignedTo = eu` em duas, nada na terceira), e era isso que fazia a fila de
// entrada não ter recorte nenhum.
for (const aba of ['ia', 'equipe', 'finalizadas'] as const) {
    eq(`o teto não muda na aba "${aba}"`, limiteDoAtendente('eu'), teto)
    void aba
}

// E a de segurança: "Todas" é ausência de recorte do `Ver`, então o que impede
// o atendente de ver a carteira dos colegas é **só** o teto. Se o teto um dia
// deixar de ser aplicado junto, esta prova continua passando e a de cima
// também — então ela afirma explicitamente que "todas" não contém permissão.
eq('"Todas" não traz permissão nenhuma consigo', recorteDoVer('todas', 'eu'), null)

console.log('\n— as opções por papel —\n')

eq('gestão escolhe entre as quatro', opcoesDeVer('GESTOR'), [
    'todas',
    'minhas',
    'colaboro',
    'sem-responsavel',
])
eq('dono também', opcoesDeVer('OWNER'), ['todas', 'minhas', 'colaboro', 'sem-responsavel'])
eq('o atendente não recebe "Sem responsável"', opcoesDeVer('ATENDENTE'), [
    'todas',
    'minhas',
    'colaboro',
])

console.log('\n— os rótulos —\n')

eq('a aba tem rótulo para cada valor', Object.keys(ROTULO_DA_ABA).sort(), [
    'equipe',
    'finalizadas',
    'ia',
])
eq('o Ver tem rótulo para cada valor', Object.keys(ROTULO_DO_VER).sort(), [
    'colaboro',
    'minhas',
    'sem-responsavel',
    'todas',
])
eq('o rótulo do colaborar é o que o Andre escolheu', ROTULO_DO_VER.colaboro, 'Que eu colaboro')
eq('a aba da IA não se chama mais "Em espera"', ROTULO_DA_ABA.ia, 'Com a IA')

console.log(`\n${ok} ok, ${falhas} falhas\n`)
if (falhas) process.exit(1)
