/**
 * Os casos do secionamento do Markdown.
 *
 *   npm run test:chunker
 *
 * `secionarMarkdown` é função pura de propósito, e é por isso que estes casos
 * existem: é o corte que decide o que o agente consegue recuperar do Cérebro, e
 * um erro aqui não aparece como erro — aparece como o agente respondendo o preço
 * de um tratamento como se fosse de outro. Dá para exercitá-lo inteiro com
 * entradas montadas à mão, sem embedding, sem banco e sem gastar um centavo.
 */
import {
    montarTrechos,
    prefixar,
    secionarMarkdown,
    semComentarios,
    TAMANHO_MAX,
} from '@venn/core/lib/rag/secoes'

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

console.log('\nTexto sem estrutura — o caminho antigo, que não pode regredir')

conferir(
    'sem cabeçalho, uma seção de caminho vazio',
    secionarMarkdown('Atendemos de segunda a sexta.\nDas 9h às 18h.'),
    [{ caminho: [], corpo: 'Atendemos de segunda a sexta.\nDas 9h às 18h.' }]
)

conferir('texto vazio não gera seção', secionarMarkdown(''), [])
conferir('só espaços não gera seção', secionarMarkdown('\n\n   \n'), [])

console.log('\nCaminho dos cabeçalhos')

const doc = `# Serviços prestados

Regra geral: nunca prometer prazo.

## Ortodontia

### Preço

A partir de R$ 180 por mês.

### Duração

De 18 a 24 meses.

## Implante

Avaliação obrigatória.`

conferir(
    'cada seção leva o caminho até ela',
    secionarMarkdown(doc).map((s) => s.caminho),
    [
        ['Serviços prestados'],
        ['Serviços prestados', 'Ortodontia', 'Preço'],
        ['Serviços prestados', 'Ortodontia', 'Duração'],
        ['Serviços prestados', 'Implante'],
    ]
)

conferir(
    'um ## novo encerra o ## anterior E os ### dele',
    secionarMarkdown(doc).at(-1)?.caminho,
    ['Serviços prestados', 'Implante']
)

conferir(
    'o corpo não carrega a linha do cabeçalho',
    secionarMarkdown(doc)[1].corpo,
    'A partir de R$ 180 por mês.'
)

console.log('\nCabeçalho sem corpo — só organiza, não vira trecho')

conferir(
    '## Ortodontia sem texto próprio não gera seção',
    secionarMarkdown('## Ortodontia\n\n### Preço\n\nR$ 180.').map((s) => s.caminho),
    [['Ortodontia', 'Preço']]
)

console.log('\nCerca de código — o caso que penduraria o acervo num cabeçalho fantasma')

const comCerca = `## Exemplos de resposta

\`\`\`
# Não é cabeçalho: é um exemplo de mensagem
Olá! Como posso ajudar?
\`\`\`

## Limites

Não prometer resultado.`

conferir(
    '# dentro de cerca não abre seção',
    secionarMarkdown(comCerca).map((s) => s.caminho),
    [['Exemplos de resposta'], ['Limites']]
)

conferir(
    'o conteúdo da cerca fica inteiro na seção dela',
    secionarMarkdown(comCerca)[0].corpo.includes('# Não é cabeçalho'),
    true
)

conferir(
    'cerca com ~~~ também conta',
    secionarMarkdown('## A\n\n~~~\n# falso\n~~~\n\n## B\n\ntexto').map((s) => s.caminho),
    [['A'], ['B']]
)

console.log('\nPreâmbulo e formas de cabeçalho')

conferir(
    'texto antes do 1º cabeçalho fica com caminho vazio',
    secionarMarkdown('Vale para tudo abaixo.\n\n# Empresa\n\nNome: X').map((s) => s.caminho),
    [[], ['Empresa']]
)

conferir(
    'cabeçalho fechado (### Preço ###) perde os # do fim',
    secionarMarkdown('### Preço ###\n\nR$ 180.')[0].caminho,
    ['Preço']
)

conferir(
    '#sem-espaço não é cabeçalho',
    secionarMarkdown('#semEspaco\n\ntexto')[0].caminho,
    []
)

conferir(
    '####### (7 cerquilhas) não é cabeçalho',
    secionarMarkdown('####### fundo\n\ntexto')[0].caminho,
    []
)

console.log('\nTabela — o que o corte por caractere partia ao meio')

const tabela = `## Preços

| Tratamento | Valor |
|---|---|
| Limpeza | R$ 150 |
| Clareamento | R$ 800 |`

const secaoTabela = secionarMarkdown(tabela)[0]
conferir('a tabela sai numa seção só', secionarMarkdown(tabela).length, 1)
conferir(
    'e cabe inteira no teto, então sai sem corte',
    prefixar(secaoTabela.caminho, secaoTabela.corpo).length <= TAMANHO_MAX,
    true
)
conferir(
    'com as duas linhas de dados intactas',
    secaoTabela.corpo.includes('Limpeza') && secaoTabela.corpo.includes('Clareamento'),
    true
)

console.log('\nO prefixo — o que faz o trecho valer sozinho')

conferir(
    'com caminho, vem colado antes do corpo',
    prefixar(['Serviços', 'Ortodontia', 'Preço'], 'R$ 180.'),
    'Serviços › Ortodontia › Preço\n\nR$ 180.'
)

conferir('sem caminho, o corpo passa como está', prefixar([], 'R$ 180.'), 'R$ 180.')

console.log('\nSeção grande demais — o pedaço que perderia o assunto')

/** Cortador de mentira, em blocos de 400: o que importa aqui é o prefixo. */
const cortarEm400 = async (corpo: string) => corpo.match(/[\s\S]{1,400}/g) ?? []

const longa = `## Ortodontia\n\n${'Detalhe do tratamento. '.repeat(90)}`
const pedacosLongos = await montarTrechos(longa, cortarEm400)

conferir('a seção passou do teto, então foi cortada', pedacosLongos.length > 1, true)
conferir(
    'TODO pedaço repete o caminho — inclusive do 2º em diante',
    pedacosLongos.every((t) => t.startsWith('Ortodontia\n\n')),
    true
)

const mista = `## Curta\n\nCabe.\n\n## Longa\n\n${'x'.repeat(2000)}`
const pedacosMistos = await montarTrechos(mista, cortarEm400)

conferir(
    'seção que cabe sai inteira e NÃO passa pelo cortador',
    pedacosMistos[0],
    'Curta\n\nCabe.'
)
conferir(
    'e a vizinha longa é a única cortada',
    pedacosMistos.slice(1).every((t) => t.startsWith('Longa\n\n')),
    true
)

conferir(
    'pedaço que vira só espaço é descartado',
    await montarTrechos(`## A\n\n${'y'.repeat(2000)}`, async () => ['', '   ', 'resta']),
    ['A\n\nresta']
)

console.log('\nComentário de HTML — nota de quem escreve, não fonte de verdade')

conferir(
    'comentário numa linha sai',
    semComentarios('Antes <!-- nota interna --> depois'),
    'Antes  depois'
)

conferir(
    'comentário de várias linhas sai inteiro',
    semComentarios('A\n<!-- confirmar\no preço\ncom a recepção -->\nB'),
    'A\n\n\n\nB'
)

conferir(
    'comentário DENTRO de cerca de código fica — é exemplo, é conteúdo',
    semComentarios('```\n<!-- isto é um exemplo -->\n```'),
    '```\n<!-- isto é um exemplo -->\n```'
)

conferir(
    'texto sem comentário passa intacto',
    semComentarios('## Serviços\n\nOrtodontia a partir de R$ 180.'),
    '## Serviços\n\nOrtodontia a partir de R$ 180.'
)

conferir(
    'comentário aberto e nunca fechado engole o resto, não vaza',
    semComentarios('Vale <!-- daqui em diante é nota\nmais nota\ne mais'),
    'Vale \n\n'
)

conferir(
    'dois comentários na mesma linha',
    semComentarios('a <!-- x --> b <!-- y --> c'),
    'a  b  c'
)

conferir(
    '``` dentro de um comentário não abre bloco de código',
    semComentarios('<!-- ``` -->\n## Real\n\ntexto'),
    '\n## Real\n\ntexto'
)

conferir(
    'depois de limpar, a seção vazia volta a contar como vazia',
    secionarMarkdown(semComentarios('## Exemplos\n\n<!-- como preencher -->\n')).length,
    0
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
