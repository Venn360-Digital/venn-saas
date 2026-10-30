/**
 * Rascunho, publicado e a volta atrás.
 *
 *   npm run test:versao
 *
 * O laço de melhoria do estudo não funciona sem duas versões na mesa: a medição
 * compara rascunho com publicado, e "piorou" só existe se houver um "antes".
 * O que decide está aqui, e é puro — quem grava é a rota de publicação.
 */
import {
    aplicarRascunhos,
    proximaVersao,
    rascunhosDaRestauracao,
    slugsQueMudam,
    temRascunhoPendente,
    type DocumentoComRascunho,
} from '@/lib/treinamento/versao'

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
