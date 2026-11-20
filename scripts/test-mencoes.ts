/**
 * A menção na nota interna — o gesto único do "colaborar".
 *
 *   npm run test:mencoes
 *
 * O que estes casos protegem, em ordem de importância:
 *
 * 1. **duas pessoas com o mesmo nome.** É a razão de o id morar dentro do
 *    texto. Se algum dia alguém "simplificar" para `@Nome`, o caso das duas
 *    Anas reprova aqui antes de reprovar na clínica.
 * 2. **prosa não vira menção.** Um e-mail, um parêntese, um colchete solto —
 *    nada disso pode marcar ninguém.
 * 3. **quem NÃO passa a colaborar.** São três recusas, e a terceira (gente de
 *    outra unidade) é a que separa "pedir ajuda a uma colega" de "expor a
 *    conversa de um paciente para outra clínica".
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    extrairMencoes,
    idsMencionados,
    notaEmTextoSimples,
    partirNota,
    quemPassaAColaborar,
    escreverMencao,
    gatilhoDeMencao,
    aplicarMencoesEscolhidas,
    inserirMencaoLegivel,
    notaDeMarcacaoEmMensagem,
    temMencao,
    temMencaoEscolhida,
} from '@venn/core/lib/conversas/mencoes'

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

console.log('\n— o que é menção —\n')

conferir('uma menção', idsMencionados('@[Ana](u1) consegue?'), ['u1'])
conferir('duas menções', idsMencionados('@[Ana](u1) e @[Carlos](u2)'), ['u1', 'u2'])
conferir('mesma pessoa duas vezes conta uma', idsMencionados('@[Ana](u1) @[Ana](u1)'), ['u1'])
conferir('nome com acento e espaço', extrairMencoes('@[Ana Paula Gonçalves](u1)'), [
    { userId: 'u1', nome: 'Ana Paula Gonçalves' },
])
conferir('nome com hífen e apóstrofo', extrairMencoes("@[D'Ávila-Souza](u9)"), [
    { userId: 'u9', nome: "D'Ávila-Souza" },
])
conferir('menção no fim da frase', idsMencionados('pergunta para @[Ana](u1)'), ['u1'])
conferir('tem menção', temMencao('oi @[Ana](u1)'), true)

console.log('\n— DUAS PESSOAS, O MESMO NOME (a razão de o id estar no texto) —\n')

conferir(
    'duas Anas são duas pessoas',
    idsMencionados('@[Ana](u1) fala com a @[Ana](u7)'),
    ['u1', 'u7']
)
conferir(
    'e os nomes iguais não se fundem',
    extrairMencoes('@[Ana](u1) e @[Ana](u7)'),
    [{ userId: 'u1', nome: 'Ana' }, { userId: 'u7', nome: 'Ana' }]
)

console.log('\n— o que NÃO é menção —\n')

conferir('e-mail não é menção', idsMencionados('manda para ana@exemplo.com.br'), [])
conferir('arroba solto não é menção', idsMencionados('@Ana consegue?'), [])
conferir('colchete sem parêntese', idsMencionados('@[Ana] consegue?'), [])
conferir('parêntese sem colchete', idsMencionados('@(u1) consegue?'), [])
conferir('id com caractere proibido', idsMencionados('@[x](javascript:alert(1))'), [])
conferir('id vazio', idsMencionados('@[Ana]()'), [])
conferir('nome vazio', idsMencionados('@[](u1)'), [])
conferir('nome atravessando linha', idsMencionados('@[Ana\nPaula](u1)'), [])
conferir('texto sem nada', temMencao('bom dia'), false)
conferir('texto vazio', idsMencionados(''), [])

console.log('\n— como a nota é renderizada e lida —\n')

conferir('partida em pedaços', partirNota('oi @[Ana](u1), vê isso'), [
    { tipo: 'texto', texto: 'oi ' },
    { tipo: 'mencao', userId: 'u1', nome: 'Ana' },
    { tipo: 'texto', texto: ', vê isso' },
])
conferir('menção no começo não gera pedaço vazio', partirNota('@[Ana](u1) oi'), [
    { tipo: 'mencao', userId: 'u1', nome: 'Ana' },
    { tipo: 'texto', texto: ' oi' },
])
conferir('texto sem menção é um pedaço só', partirNota('bom dia'), [
    { tipo: 'texto', texto: 'bom dia' },
])
conferir(
    'a sintaxe não vaza para quem lê',
    notaEmTextoSimples('@[Ana Paula](cku123) consegue quinta?'),
    '@Ana Paula consegue quinta?'
)

console.log('\n— quem PASSA a colaborar, e quem não —\n')

const base = { autorId: 'rute', donoId: 'rute', idsDaUnidade: ['rute', 'ana', 'carlos'] }

conferir('colega da unidade passa a colaborar', quemPassaAColaborar({ ...base, mencionados: ['ana'] }), [
    'ana',
])
conferir(
    'quem escreveu não se chama a si mesmo',
    quemPassaAColaborar({ ...base, mencionados: ['rute', 'ana'] }),
    ['ana']
)
conferir(
    'o responsável não vira colaborador do que já é dele',
    quemPassaAColaborar({ ...base, autorId: 'ana', mencionados: ['rute'] }),
    []
)
conferir(
    'gente de OUTRA unidade não entra',
    quemPassaAColaborar({ ...base, mencionados: ['ana', 'estranho'] }),
    ['ana']
)
conferir(
    'conversa sem dono: só as duas primeiras recusas valem',
    quemPassaAColaborar({ ...base, donoId: null, mencionados: ['ana', 'carlos'] }),
    ['ana', 'carlos']
)
conferir('ninguém marcado', quemPassaAColaborar({ ...base, mencionados: [] }), [])

console.log('\n— o gatilho do seletor @ —\n')

conferir('@ no começo abre vazio', gatilhoDeMencao('@'), '')
conferir('@ depois de espaço abre', gatilhoDeMencao('olha isso @'), '')
conferir('@ depois de quebra de linha abre', gatilhoDeMencao('linha\n@'), '')
conferir('o que foi digitado volta', gatilhoDeMencao('@an'), 'an')
conferir('sem @ não há gatilho', gatilhoDeMencao('olha isso'), null)

// (1) e-mail digitado na nota não pode abrir o seletor.
conferir('e-mail não abre', gatilhoDeMencao('manda pro joao@clinica.com'), null)
conferir('@ colado em letra não abre', gatilhoDeMencao('ana@'), null)
conferir('@ colado em dígito não abre', gatilhoDeMencao('sala2@'), null)

// (2) o nome vem da lista; espaço encerra a busca.
conferir('espaço fecha', gatilhoDeMencao('@ pode ver'), null)
conferir('quebra de linha fecha', gatilhoDeMencao('@ana\nproximo'), null)

// (3) uma menção já fechada não reabre o seletor sozinha.
conferir('menção fechada não reabre', gatilhoDeMencao('@[Ana](u1)'), null)
conferir('colchete aberto não é busca', gatilhoDeMencao('@[An'), null)

conferir('texto longo não é busca de nome', gatilhoDeMencao('@' + 'a'.repeat(41)), null)
conferir('40 caracteres ainda é busca', gatilhoDeMencao('@' + 'a'.repeat(40)), 'a'.repeat(40))

console.log('\n— escrever e inserir —\n')

conferir('o formato é o que o leitor reconhece', escreverMencao('Ana Paula', 'cku123'), '@[Ana Paula](cku123)')
conferir(
    'o que foi escrito volta na extração',
    idsMencionados(escreverMencao('Ana Paula', 'cku123')),
    ['cku123']
)
conferir(']' + ' no nome não quebra o formato', escreverMencao('Ana] Paula', 'u1'), '@[Ana  Paula](u1)')

/**
 * A inserção troca o `@an` pelo **nome**, sem o id, e deixa o cursor depois do
 * espaço. O id só volta ao texto no envio — é o pedido do Andre em 20/11/2026,
 * e é o que as provas da conversão abaixo garantem.
 */
conferir(
    'troca o que estava sendo digitado pelo nome legível',
    inserirMencaoLegivel('olha isso @an', 13, 'Ana'),
    { texto: 'olha isso @Ana ', cursor: 15 }
)
conferir(
    'preserva o que vem depois do cursor',
    inserirMencaoLegivel('@an, pode ver?', 3, 'Ana'),
    { texto: '@Ana , pode ver?', cursor: 5 }
)
conferir(
    'sem @ antes do cursor não mexe no texto',
    inserirMencaoLegivel('sem marcação', 5, 'Ana'),
    { texto: 'sem marcação', cursor: 5 }
)

console.log('\n— o nome legível virando a sintaxe gravada —\n')

conferir(
    'o nome escolhido volta com o id',
    aplicarMencoesEscolhidas('@Ana olha isso', [{ userId: 'u1', nome: 'Ana' }]),
    '@[Ana](u1) olha isso'
)
conferir(
    'sem escolha nenhuma o texto não muda',
    aplicarMencoesEscolhidas('@Ana olha isso', []),
    '@Ana olha isso'
)

// Regra 1: o nome mais longo casa primeiro, senão "Ana Paula" viraria
// `@[Ana](u1) Paula` e a segunda pessoa viraria prosa.
conferir(
    'o nome mais longo casa primeiro',
    aplicarMencoesEscolhidas('@Ana Paula confere?', [
        { userId: 'u1', nome: 'Ana' },
        { userId: 'u2', nome: 'Ana Paula' },
    ]),
    '@[Ana Paula](u2) confere?'
)

// Regra 2: duas pessoas de mesmo nome — o texto não as distingue, então as
// escolhas são consumidas na ordem em que foram feitas.
conferir(
    'duas Anas saem na ordem em que foram escolhidas',
    aplicarMencoesEscolhidas('@Ana e @Ana, vejam', [
        { userId: 'u1', nome: 'Ana' },
        { userId: 'u2', nome: 'Ana' },
    ]),
    '@[Ana](u1) e @[Ana](u2), vejam'
)

// Regra 3: quem apagou o nome depois de escolher não marcou ninguém.
conferir(
    'escolha cujo nome foi apagado é descartada',
    aplicarMencoesEscolhidas('deixa pra depois', [{ userId: 'u1', nome: 'Ana' }]),
    'deixa pra depois'
)
conferir(
    'o id só entra no texto na conversão',
    idsMencionados(aplicarMencoesEscolhidas('@Ana olha', [{ userId: 'cku9', nome: 'Ana' }])),
    ['cku9']
)

// `@Ana` não casa dentro de `@Anabela`: o seletor que escolheu "Ana" não pode
// marcá-la porque o nome dela é prefixo do nome de outra pessoa.
conferir(
    'nome que continua em outra palavra não casa',
    aplicarMencoesEscolhidas('@Anabela chegou', [{ userId: 'u1', nome: 'Ana' }]),
    '@Anabela chegou'
)

/**
 * A faixa de aviso do compositor lê daqui: ela só aparece quando **há** uma
 * escolha viva no texto, e não quando a pessoa digitou um `@` qualquer — a
 * faixa prometendo nota interna sem que a menção exista seria uma mentira na
 * tela.
 */
conferir(
    'a faixa acende com a escolha viva no texto',
    temMencaoEscolhida('@Ana olha', [{ userId: 'u1', nome: 'Ana' }]),
    true
)
conferir(
    'a faixa não acende com @ solto',
    temMencaoEscolhida('@ olha', [{ userId: 'u1', nome: 'Ana' }]),
    false
)
conferir(
    'a faixa apaga quando o nome sai do texto',
    temMencaoEscolhida('deixa pra depois', [{ userId: 'u1', nome: 'Ana' }]),
    false
)

console.log('\n— marcar um colega numa mensagem (botão direito) —\n')

/**
 * O terceiro gesto produz uma nota que o leitor já entende: a menção no
 * formato gravado, e o trecho citado — cortado, para uma mensagem longa não
 * virar uma nota longa.
 */
conferir(
    'a nota leva a menção no formato gravado e o trecho entre aspas',
    notaDeMarcacaoEmMensagem({
        nome: 'Ana',
        userId: 'u1',
        autorDaMensagem: 'Carlos',
        trecho: 'quanto custa o implante?',
        horario: '14:32',
    }),
    '@[Ana](u1) dá uma olhada na mensagem de Carlos às 14:32: «quanto custa o implante?»'
)
conferir(
    'a nota é lida pelo extrator como qualquer outra',
    idsMencionados(
        notaDeMarcacaoEmMensagem({ nome: 'Ana', userId: 'u1', autorDaMensagem: 'Carlos', trecho: 'oi', horario: '09:00' })
    ),
    ['u1']
)
conferir(
    'trecho longo é cortado com reticências',
    notaDeMarcacaoEmMensagem({
        nome: 'Ana',
        userId: 'u1',
        autorDaMensagem: 'Carlos',
        trecho: 'x'.repeat(300),
        horario: '09:00',
    }).endsWith(`${'x'.repeat(159)}…»`),
    true
)
conferir(
    'quebras de linha do trecho viram espaço, e vazio vira (sem texto)',
    [
        notaDeMarcacaoEmMensagem({ nome: 'Ana', userId: 'u1', autorDaMensagem: 'C', trecho: 'a\n\nb', horario: '1' }).includes('«a b»'),
        notaDeMarcacaoEmMensagem({ nome: 'Ana', userId: 'u1', autorDaMensagem: 'C', trecho: '  ', horario: '1' }).includes('«(sem texto)»'),
    ],
    [true, true]
)

console.log(`\n${passou} ok, ${falhou} falhas\n`)
if (falhou > 0) process.exit(1)
