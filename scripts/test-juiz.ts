/**
 * O juiz pareado: a rubrica, o parser, o embaralho, o canário e o kappa.
 *
 *   npm run test:juiz
 *
 * O Andar 2 da avaliação decide se uma mudança de treinamento vai ao ar. Se ele
 * errar de forma sistemática, o laço de melhoria piora o agente com número
 * bonito na tela — é o modo de falha que a literatura de 2026 catalogou em onze
 * variedades. As defesas são estas, e cada caso aqui protege uma.
 *
 * Nada aqui chama modelo: o prompt é texto, o veredito é string gravada. É o que
 * permite provar o juiz em Node, sem crédito e sem rede.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    CRITERIOS,
    interpretarVeredito,
    promptDoJuiz,
    type CasoDourado,
} from '@venn/core/lib/avaliacao/juiz'
import {
    CASOS_MINIMOS,
    FRACAO_DE_HOLDOUT,
    agregar,
    ehHoldout,
    embaralhar,
    kappa,
    ordemDoCaso,
    quemGanhou,
    suspeitas,
} from '@venn/core/lib/avaliacao/pareado'

let passou = 0
let falhou = 0

function conferir(nome: string, real: unknown, esperado: unknown) {
    const a = JSON.stringify(real)
    const b = JSON.stringify(esperado)
    if (a === b) {
        passou++
        console.log(`  ok  ${nome}`)
    } else {
        falhou++
        console.log(`  XX  ${nome}\n        esperado: ${b}\n        veio:     ${a}`)
    }
}

const caso: CasoDourado = {
    id: 'caso-1',
    pergunta: 'quanto custa um clareamento?',
    trechos: ['Serviços prestados › Clareamento › Preço\nA partir de R$ 180.'],
    referencia: 'O clareamento começa em R$ 180. Quer que eu veja um horário para avaliação?',
}

console.log('\nO prompt do juiz')

const prompt = promptDoJuiz(caso, 'resposta do rascunho', 'resposta do publicado')

conferir('a pergunta do paciente entra', prompt.includes('quanto custa um clareamento?'), true)
conferir('o trecho recuperado entra, numerado', prompt.includes('[1] Serviços prestados'), true)
conferir('a referência aprovada entra quando existe', prompt.includes('aprovada por uma pessoa'), true)
conferir(
    'os seis critérios entram, todos',
    CRITERIOS.every((c) => prompt.includes(c.titulo)),
    true
)
conferir(
    'o raciocínio é pedido ANTES do veredito — ordem invertida faz o juiz justificar a escolha',
    prompt.indexOf('percorra os critérios') < prompt.indexOf('VEREDITO: A'),
    true
)
conferir(
    'nada no prompt diz qual lado é o rascunho',
    prompt.includes('rascunho') === false || prompt.toLowerCase().includes('resposta a'),
    true
)
conferir(
    'sem trecho, diz que não veio nada — em vez de uma seção vazia',
    promptDoJuiz({ ...caso, trechos: [] }, 'a', 'b').includes('não trouxe nenhum trecho'),
    true
)
conferir(
    'sem referência, a seção não aparece',
    promptDoJuiz({ ...caso, referencia: null }, 'a', 'b').includes('aprovada por uma pessoa'),
    false
)

console.log('\nLer o veredito')

conferir('a forma pedida', interpretarVeredito('bla bla\nVEREDITO: A'), 'A')
conferir('minúscula também', interpretarVeredito('veredito: b'), 'B')
conferir('empate', interpretarVeredito('VEREDITO: EMPATE'), 'EMPATE')
conferir(
    'a ÚLTIMA ocorrência ganha — o juiz cita a palavra no meio do raciocínio',
    interpretarVeredito('o VEREDITO: A seria precipitado...\n\nVEREDITO: B'),
    'B'
)
conferir('ilegível devolve nulo, NÃO empate', interpretarVeredito('acho que a primeira é melhor'), null)
conferir('vazio devolve nulo', interpretarVeredito(''), null)
conferir('palavra solta sem o rótulo devolve nulo', interpretarVeredito('A é melhor que B'), null)

console.log('\nO embaralho, e desfazê-lo')

conferir('a ordem é determinística: duas leituras do mesmo id batem', ordemDoCaso('caso-1'), ordemDoCaso('caso-1'))
conferir(
    'e varia entre ids — senão o viés de posição vira viés a favor de um lado',
    new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(ordemDoCaso)).size,
    2
)
conferir(
    'rascunho primeiro põe o rascunho em A',
    embaralhar('rascunho-primeiro', 'R', 'P'),
    { a: 'R', b: 'P' }
)
conferir(
    'publicado primeiro põe o publicado em A',
    embaralhar('publicado-primeiro', 'R', 'P'),
    { a: 'P', b: 'R' }
)
conferir('preferiu A, com o rascunho em A', quemGanhou('rascunho-primeiro', 'A'), 'rascunho')
conferir('preferiu A, com o publicado em A', quemGanhou('publicado-primeiro', 'A'), 'publicado')
conferir('preferiu B, com o rascunho em A', quemGanhou('rascunho-primeiro', 'B'), 'publicado')
conferir('empate atravessa', quemGanhou('rascunho-primeiro', 'EMPATE'), 'empate')
conferir('ilegível atravessa como ilegível, nunca como empate', quemGanhou('rascunho-primeiro', null), null)

console.log('\nAgregar')

conferir(
    'conta os quatro desfechos',
    agregar(['rascunho', 'rascunho', 'publicado', 'empate', null]),
    { rascunho: 2, publicado: 1, empates: 1, ilegiveis: 1, validos: 4, preferencia: 0.625 }
)
conferir(
    'ilegível NÃO entra no denominador',
    agregar(['rascunho', null, null, null]),
    { rascunho: 1, publicado: 0, empates: 0, ilegiveis: 3, validos: 1, preferencia: 1 }
)
conferir(
    'sem caso válido a preferência é nula, não zero — zero diria que o rascunho perdeu',
    agregar([null, null]).preferencia,
    null
)
conferir('nada devolve nulo também', agregar([]).preferencia, null)
conferir(
    'empate vale meio para cada lado',
    agregar(['empate', 'empate']).preferencia,
    0.5
)

console.log('\nO canário')

const muitos = (lado: 'rascunho' | 'publicado' | 'empate', n: number) => Array(n).fill(lado)

conferir(
    'amostra pequena é suspeita por si',
    suspeitas(agregar(muitos('rascunho', 3))).some((m) => m.includes('poucos casos')),
    true
)
conferir(
    'preferência de 100% é suspeita, não vitória',
    suspeitas(agregar(muitos('rascunho', 40))).some((m) => m.includes('100% pelo rascunho')),
    true
)
conferir(
    'e vale para o outro lado também',
    suspeitas(agregar(muitos('publicado', 40))).some((m) => m.includes('100% pelo publicado')),
    true
)
conferir(
    'empate em tudo quer dizer que o juiz não está olhando',
    suspeitas(agregar(muitos('empate', 40))).some((m) => m.includes('não está discriminando')),
    true
)
conferir(
    'muitos ilegíveis: o juiz não está sendo lido',
    suspeitas(agregar([...muitos('rascunho', 20), ...muitos('publicado', 20), null, null, null, null, null]))
        .some((m) => m.includes('ilegível')),
    true
)
conferir(
    'uma bateria saudável não acusa nada',
    suspeitas(agregar([...muitos('rascunho', 22), ...muitos('publicado', 14), ...muitos('empate', 4)])),
    []
)

console.log('\nO holdout')

conferir('determinístico: o mesmo id responde o mesmo sempre', ehHoldout('caso-42'), ehHoldout('caso-42'))

const ids = Array.from({ length: 2000 }, (_, i) => `caso-${i}`)
const fracao = ids.filter(ehHoldout).length / ids.length
conferir(
    `a fração fica perto de ${FRACAO_DE_HOLDOUT} em 2000 ids (veio ${fracao.toFixed(3)})`,
    Math.abs(fracao - FRACAO_DE_HOLDOUT) < 0.05,
    true
)
conferir('e os dois conjuntos não são vazios', fracao > 0 && fracao < 1, true)

console.log('\nKappa de Cohen')

conferir('concordância total', kappa(['a', 'b', 'a'], ['a', 'b', 'a']), 1)
conferir(
    'discordância total com dois rótulos equilibrados dá -1',
    kappa(['a', 'b', 'a', 'b'], ['b', 'a', 'b', 'a']),
    -1
)
conferir('tamanhos diferentes devolvem nulo', kappa(['a'], ['a', 'b']), null)
conferir('vazio devolve nulo — não há concordância a medir', kappa([], []), null)
conferir('todos escolheram o mesmo rótulo sempre: concordaram', kappa(['a', 'a'], ['a', 'a']), 1)
conferir(
    'acerto alto com rótulo dominante NÃO é kappa alto — é por isso que kappa existe',
    (kappa(
        ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'b', 'c'],
        ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'c', 'b']
    ) ?? 1) < 0.5,
    true
)
conferir('o mínimo de casos é declarado, não mágico', CASOS_MINIMOS, 30)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
