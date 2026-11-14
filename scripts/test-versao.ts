/**
 * Rascunho, publicado e a volta atrás.
 *
 *   npm run test:versao
 *
 * O laço de melhoria do estudo não funciona sem duas versões na mesa: a medição
 * compara rascunho com publicado, e "piorou" só existe se houver um "antes".
 * O que decide está aqui, e é puro — quem grava é a rota de publicação.
 *
 * Cobre também o **acervo atrasado**: publicar não depende só de alguém ter
 * editado texto. Quando muda o código que decide o que vai para o acervo, todo
 * documento já indexado fica obsoleto de uma vez — e o incidente de 2026-10-31
 * está reproduzido aqui, com a regra de recorte antiga contra a nova.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    aplicarRascunhos,
    proximaVersao,
    rascunhosDaRestauracao,
    slugsComResiduoDeAcervo,
    slugsDesatualizados,
    slugsQueMudam,
    temRascunhoPendente,
    type AcervoDoDocumento,
    type DocumentoComRascunho,
} from '@venn/core/lib/treinamento/versao'
import { hashDoAcervo, hashDoConteudo } from '@venn/core/lib/treinamento/indexar'
import { semComentarios } from '@venn/core/lib/rag/secoes'

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

const docs: DocumentoComRascunho[] = [
    { slug: 'instrucoes-centrais', content: 'no ar', draftContent: 'mudado' },
    { slug: 'privacidade', content: 'no ar', draftContent: null },
    // Rascunho idêntico: a tela grava a cada salvar, e salvar sem mudar nada não
    // pode produzir versão nova nem reenfileirar indexação.
    { slug: 'servicos', content: 'igual', draftContent: 'igual' },
    { slug: 'faq', content: 'velho', draftContent: 'novo' },
]

console.log('\nO que muda ao publicar')

conferir('só os que de fato mudaram', slugsQueMudam(docs), ['instrucoes-centrais', 'faq'])
conferir('rascunho idêntico ao publicado NÃO conta', slugsQueMudam(docs).includes('servicos'), false)
conferir('sem rascunho não conta', slugsQueMudam(docs).includes('privacidade'), false)
conferir('há pendência', temRascunhoPendente(docs), true)
conferir(
    'nada pendente quando todos os rascunhos são iguais ou nulos',
    temRascunhoPendente([
        { slug: 'a', content: 'x', draftContent: 'x' },
        { slug: 'b', content: 'y', draftContent: null },
    ]),
    false
)
conferir('lista vazia não tem pendência', temRascunhoPendente([]), false)

console.log('\nO acervo atrasado — mudança de CÓDIGO, não de texto')

/*
 * O defeito de 2026-10-31: `textoParaAcervo` passou a retirar mais seções, e
 * todo documento já indexado ficou obsoleto sem ninguém editar nada. Sem
 * rascunho pendente, `slugsQueMudam` não via nada e a tela não tinha como
 * reindexar — o conserto saiu por SQL à mão.
 */
const acervo: AcervoDoDocumento[] = [
    // Indexado com um texto que o corte de hoje não produz mais.
    { slug: 'faq', ehAcervo: true, indexado: 'aaa', agora: 'bbb' },
    // Em dia: não pode entrar, senão todo Publicar reindexaria o acervo inteiro.
    { slug: 'servicos', ehAcervo: true, indexado: 'ccc', agora: 'ccc' },
    // Nunca indexado. Job em voo ou job que falhou — reindexar não é o remédio,
    // e acender o aviso aqui faria a tela pedir reindexação logo após publicar.
    { slug: 'cenarios', ehAcervo: true, indexado: null, agora: 'ddd' },
    // Modo prompt: vai inteiro no prompt, não tem acervo para comparar.
    { slug: 'privacidade', ehAcervo: false, indexado: 'eee', agora: 'fff' },
    // Tem trechos no acervo para um texto que hoje não renderia trecho nenhum.
    // É o caso mais grave: o agente responde pelo que já não existe.
    { slug: 'empresa', ehAcervo: true, indexado: 'ggg', agora: null },
]

conferir('indexado ≠ o que seria indexado agora conta', slugsDesatualizados(acervo), ['faq', 'empresa'])
conferir('em dia NÃO conta', slugsDesatualizados(acervo).includes('servicos'), false)
conferir('nunca indexado NÃO conta', slugsDesatualizados(acervo).includes('cenarios'), false)
conferir('documento de prompt NÃO conta', slugsDesatualizados(acervo).includes('privacidade'), false)
conferir('indexado com acervo hoje vazio conta', slugsDesatualizados(acervo).includes('empresa'), true)

console.log('\nResíduo: quem deixou de ser acervo e ficou com trechos')

/**
 * O caso real que criou esta função: `servicos` e `faq` viraram modo prompt em
 * 2026-11-12 com trechos já indexados. Note que o `acervo` acima já tem um
 * documento nesse estado — `privacidade`, com `ehAcervo: false` e `indexado`
 * preenchido —, e `slugsDesatualizados` o ignora de propósito. As duas funções
 * leem os mesmos dois campos e respondem perguntas diferentes.
 */
conferir(
    'não é mais acervo e tem trechos: é resíduo, e é o que a publicação apaga',
    slugsComResiduoDeAcervo(acervo),
    ['privacidade']
)
conferir(
    'documento de prompt que NUNCA foi vetorizado não tem nada a limpar',
    slugsComResiduoDeAcervo([{ slug: 'instrucoes-centrais', ehAcervo: false, indexado: null, agora: 'x' }]),
    []
)
conferir(
    'acervo de verdade com trechos NÃO é resíduo — reindexar é outra coisa',
    slugsComResiduoDeAcervo([{ slug: 'cenarios', ehAcervo: true, indexado: 'aaa', agora: 'bbb' }]),
    []
)
conferir(
    'as duas funções não se sobrepõem: nenhum slug cai nas duas listas',
    slugsDesatualizados(acervo).filter((s) => slugsComResiduoDeAcervo(acervo).includes(s)),
    []
)
conferir('lista vazia não tem atrasado', slugsDesatualizados([]), [])

console.log('\nO hash do acervo — a outra metade da comparação')

/*
 * Tem de ser o MESMO cálculo que o processador grava em `indexedHash`, senão a
 * comparação acusa atraso em todo documento e reindexa o acervo inteiro a cada
 * publicação. O processador hasheia `textoParaAcervo(content).texto`.
 */
const comExemplos = [
    '# Perguntas frequentes',
    '',
    '## Dói?',
    'Com anestesia, não.',
    '',
    '## Exemplos ou sugestões de resposta',
    '- "Oi! Tudo bem?"',
].join('\n')

const soOsFatos = ['# Perguntas frequentes', '', '## Dói?', 'Com anestesia, não.'].join('\n')

conferir(
    'hasheia o texto DEPOIS do recorte: com e sem a seção de exemplos dá o mesmo hash',
    await hashDoAcervo(comExemplos),
    await hashDoAcervo(soOsFatos)
)
conferir(
    'e é o mesmo número que o processador grava em indexedHash',
    await hashDoAcervo(comExemplos),
    await hashDoConteudo(soOsFatos)
)
conferir('documento vazio não tem hash de acervo: é nulo, não string vazia', await hashDoAcervo(''), null)
conferir(
    'documento só com comentário de quem escreve também é nulo',
    await hashDoAcervo('<!-- confirmar preço com a recepção -->'),
    null
)
conferir(
    'e documento reduzido à seção de exemplos também — nada de fato a indexar',
    await hashDoAcervo('## Exemplos ou sugestões de resposta\n- "Oi!"'),
    null
)

console.log('\nO incidente de 2026-10-31, reproduzido')

/*
 * O caso real, de ponta a ponta e sem banco: o documento está no ar com o
 * carimbo que a regra ANTIGA de recorte produziu — ela só tirava comentário, e
 * deixava a seção de exemplos entrar no acervo. Depois do conserto de
 * `ehSecaoDeExemplos`, o mesmo texto passa a dar outro recorte.
 *
 * Ninguém editou nada: `slugsQueMudam` não vê nada, e sem `slugsDesatualizados`
 * a tela ficava mostrando "indexado em 10 trechos" ao lado de "8 trechos" sem
 * botão nenhum, enquanto três diálogos de exemplo seguiam sendo servidos ao
 * modelo como fonte de verdade.
 */
const noAr = [
    '# Perguntas frequentes',
    '',
    '## Quanto custa a avaliação?',
    'A primeira avaliação é gratuita.',
    '',
    '## Exemplos ou sugestões de resposta',
    '- "Oi! A primeira avaliação é por nossa conta."',
    '- "Posso já reservar um horário para você?"',
].join('\n')

/* O que o indexador de antes do conserto teria gravado em `indexedHash`. */
const carimboAntigo = await hashDoConteudo(semComentarios(noAr).trim())

const comoEstava: DocumentoComRascunho[] = [{ slug: 'faq', content: noAr, draftContent: null }]
const acervoDeHoje: AcervoDoDocumento[] = [
    { slug: 'faq', ehAcervo: true, indexado: carimboAntigo, agora: await hashDoAcervo(noAr) },
]

conferir('o texto não mudou, então não há o que publicar', slugsQueMudam(comoEstava), [])
conferir('mas o acervo está atrasado, e agora a tela sabe', slugsDesatualizados(acervoDeHoje), ['faq'])
conferir(
    'e depois de reindexar o carimbo bate — reindexar de novo não paga embedding',
    slugsDesatualizados([
        { slug: 'faq', ehAcervo: true, indexado: await hashDoAcervo(noAr), agora: await hashDoAcervo(noAr) },
    ]),
    []
)

console.log('\nO instantâneo')

conferir(
    'traz TODOS os documentos, não só os que mudaram — instantâneo pela metade não desfaz nada',
    aplicarRascunhos(docs),
    [
        { slug: 'instrucoes-centrais', content: 'mudado' },
        { slug: 'privacidade', content: 'no ar' },
        { slug: 'servicos', content: 'igual' },
        { slug: 'faq', content: 'novo' },
    ]
)
conferir('lista vazia dá instantâneo vazio', aplicarRascunhos([]), [])

console.log('\nA numeração')

conferir('a primeira publicação é a versão 1 — zero é "nunca publicou"', proximaVersao(0), 1)
conferir('e segue de um em um', proximaVersao(11), 12)
conferir('negativo não existe: trata como zero', proximaVersao(-5), 1)
conferir('fracionário é truncado antes de somar', proximaVersao(3.7), 4)

console.log('\nA volta atrás')

const instantaneo = [
    { slug: 'instrucoes-centrais', content: 'versao antiga' },
    { slug: 'privacidade', content: 'no ar' },
    { slug: 'faq', content: 'faq antiga' },
]
const atuais: DocumentoComRascunho[] = [
    { slug: 'instrucoes-centrais', content: 'no ar agora', draftContent: null },
    { slug: 'privacidade', content: 'no ar', draftContent: null },
    { slug: 'faq', content: 'faq de agora', draftContent: null },
]

conferir(
    'volta como RASCUNHO, nunca direto para o ar — desfazer também passa pela medição',
    rascunhosDaRestauracao(instantaneo, atuais),
    [
        { slug: 'instrucoes-centrais', draftContent: 'versao antiga' },
        { slug: 'faq', draftContent: 'faq antiga' },
    ]
)
conferir(
    'o que já está idêntico no ar não gera rascunho — senão a tela mentiria dizendo "há mudanças"',
    rascunhosDaRestauracao(instantaneo, atuais).some((d) => d.slug === 'privacidade'),
    false
)
conferir(
    'restaurar a versão igual à de agora não propõe nada',
    rascunhosDaRestauracao(
        [{ slug: 'a', content: 'x' }],
        [{ slug: 'a', content: 'x', draftContent: null }]
    ),
    []
)
conferir(
    'slug que existe no instantâneo e não existe mais é proposto como rascunho',
    rascunhosDaRestauracao([{ slug: 'cenarios', content: 'texto' }], []),
    [{ slug: 'cenarios', draftContent: 'texto' }]
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
