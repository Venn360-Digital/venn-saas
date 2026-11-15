/**
 * A fusão das duas buscas e o teto por documento.
 *
 *   npm run test:fusao
 *
 * A busca ficou híbrida porque a medição de 2026-10-29 apontou duas faces do
 * mesmo defeito: `faq` dominava (primeira colocada em 13 de 14 recuperações, por
 * ser escrita em forma de pergunta) e `servicos` perdia as perguntas de preço,
 * porque "R$ 180" não tem vizinho vetorial útil.
 *
 * O que decide está aqui, e é puro: a fusão por posição, o teto por documento e
 * os termos que vão para o `to_tsquery`. O SQL é exercitado contra banco de
 * verdade por `npm run check:neon`.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    diversificarPorDocumento,
    fundirRRF,
    K_RRF,
    reservarVagaParaProcedimento,
    termosLexicais,
} from '@venn/core/lib/rag/fusao'

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

const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

console.log('\nFusão por posição (RRF)')

conferir(
    'achado pelas duas buscas ganha de quem só uma achou',
    ids(
        fundirRRF([
            { id: 'so-vetor', titulo: 'a', posicaoVetor: 1 },
            { id: 'as-duas', titulo: 'b', posicaoVetor: 3, posicaoLexical: 3 },
            { id: 'so-lexical', titulo: 'c', posicaoLexical: 1 },
        ])
    ),
    ['as-duas', 'so-lexical', 'so-vetor']
)

/**
 * O caso medido: o trecho de preço que o vetor põe longe e o lexical põe em 1º.
 * Sem a fusão ele não entraria na resposta; com ela, entra à frente de trechos
 * que o vetor classificou melhor.
 */
conferir(
    'o 1º do lexical passa à frente do 2º do vetor',
    ids(
        fundirRRF([
            { id: 'vetor-2', titulo: 'faq', posicaoVetor: 2 },
            { id: 'preco', titulo: 'servicos', posicaoVetor: 30, posicaoLexical: 1 },
        ])
    ),
    ['preco', 'vetor-2']
)
conferir(
    'mas o 1º do vetor ainda ganha do 1º do lexical quando só um achou cada',
    ids(
        fundirRRF([
            { id: 'lex-1', titulo: 'a', posicaoLexical: 1 },
            { id: 'vet-1', titulo: 'b', posicaoVetor: 1 },
        ])
    ),
    ['lex-1', 'vet-1']
)
conferir(
    'empate de nota desempata pelo id, para a medição ser reprodutível',
    ids(
        fundirRRF([
            { id: 'zz', titulo: 'a', posicaoVetor: 1 },
            { id: 'aa', titulo: 'b', posicaoLexical: 1 },
        ])
    ),
    ['aa', 'zz']
)
conferir('candidato sem posição nenhuma é descartado', fundirRRF([{ id: 'x', titulo: 'a' }]), [])
conferir('lista vazia devolve vazio', fundirRRF([]), [])

conferir(
    'k = 60 amortece: 1º e 2º diferem pouco, e é isso que deixa a outra busca pesar',
    [
        Number((1 / (K_RRF + 1) / (1 / (K_RRF + 2))).toFixed(3)),
        Number((1 / (1 + 1) / (1 / (1 + 2))).toFixed(3)),
    ],
    [1.016, 1.5]
)

console.log('\nTeto por documento')

const cinco = [
    { id: '1', titulo: 'faq' },
    { id: '2', titulo: 'faq' },
    { id: '3', titulo: 'faq' },
    { id: '4', titulo: 'faq' },
    { id: '5', titulo: 'servicos' },
]

conferir(
    'o 4º trecho da FAQ cede a vaga ao 1º de serviços',
    ids(diversificarPorDocumento(cinco, 3, 4)),
    ['1', '2', '3', '5']
)
conferir(
    'o teto não reordena: a ordem da fusão é preservada',
    ids(diversificarPorDocumento(cinco, 3, 5)),
    ['1', '2', '3', '5', '4']
)
conferir(
    'acervo de um documento só não entrega menos — a segunda passada devolve as vagas',
    ids(
        diversificarPorDocumento(
            [
                { id: '1', titulo: 'faq' },
                { id: '2', titulo: 'faq' },
                { id: '3', titulo: 'faq' },
                { id: '4', titulo: 'faq' },
                { id: '5', titulo: 'faq' },
            ],
            3,
            5
        )
    ),
    ['1', '2', '3', '4', '5']
)
conferir('teto zero desliga o teto', ids(diversificarPorDocumento(cinco, 0, 5)), ['1', '2', '3', '4', '5'])
conferir('limite zero devolve vazio', diversificarPorDocumento(cinco, 3, 0), [])
conferir(
    'limite maior que a lista devolve a lista',
    ids(diversificarPorDocumento(cinco, 3, 99)),
    ['1', '2', '3', '5', '4']
)

console.log('\nOs termos que vão para o to_tsquery')

conferir(
    'termos em OU, porque E devolve zero em pergunta de paciente',
    termosLexicais('quanto custa o clareamento'),
    'quanto | custa | clareamento'
)
conferir(
    'o número sobrevive — é o caso que a perna lexical veio resolver',
    termosLexicais('o aparelho sai 180 reais?'),
    'aparelho | sai | 180 | reais'
)
conferir(
    'símbolo e pontuação saem: dentro do to_tsquery eles são OPERADOR e derrubam a consulta',
    termosLexicais('quanto custa? R$ 180,00 — tá caro!'),
    // `R$` vira `r` e cai no corte de duas letras, junto de `tá` e do `00` de
    // `180,00`. O que sobra é o que de fato identifica o trecho.
    'quanto | custa | 180 | caro'
)
conferir('palavra de duas letras sai', termosLexicais('eu já vi o kit'), 'kit')
conferir(
    'acento é preservado — quem tira acento é o unaccent do Postgres, no SQL',
    termosLexicais('orçamento'),
    'orçamento'
)
conferir('repetição conta uma vez', termosLexicais('preço preço preço valor'), 'preço | valor')
/**
 * Saudação **gera** termos, e isso é correto — quem a descarta é o Postgres.
 *
 * "oi" cai no corte de duas letras, mas "tudo" e "bem" passam. A configuração
 * `portuguese` trata as duas como palavra vazia, então o `to_tsquery` resultante
 * é vazio e o `@@` não casa nada: zero acerto, sem erro. Medido contra o acervo
 * real em 2026-10-30 — "oi, tudo bem?", "obrigado!" e "tá caro, vou pensar"
 * deram **zero** acerto lexical.
 *
 * Filtrar palavra vazia aqui seria manter uma segunda lista de *stopwords* em
 * português, que envelheceria separada da do banco.
 */
conferir('saudação gera termos; descartá-los é trabalho do Postgres', termosLexicais('oi, tudo bem?'), 'tudo | bem')
conferir('mas o nulo existe, e aí a perna lexical NÃO roda', termosLexicais('oi'), null)
conferir('texto vazio devolve nulo', termosLexicais(''), null)
conferir('só pontuação devolve nulo', termosLexicais('?!...'), null)
conferir(
    'teto de termos, para a consulta não crescer sem limite',
    termosLexicais('uma duas tres quatro cinco seis sete oito nove dez onze doze', 3),
    'uma | duas | tres'
)

console.log('\nA vaga do servico')

const CENARIO = 'cenario'

/** O caso que motivou isto: muito site, um cenário, e ele ficou de fora. */
const afogado = [
    { id: 's1', titulo: 'Home | site', tipo: 'website' },
    { id: 's2', titulo: 'Produtos | site', tipo: 'website' },
    { id: 's3', titulo: 'Telas | site', tipo: 'website' },
    { id: 's4', titulo: 'Arames | site', tipo: 'website' },
    { id: 's5', titulo: 'Pregos | site', tipo: 'website' },
    { id: 'c1', titulo: 'cenarios', tipo: CENARIO },
]

conferir(
    'nenhum servico entrou: ele toma a vaga do ÚLTIMO colocado',
    ids(reservarVagaParaProcedimento(afogado.slice(0, 5), afogado, 5, CENARIO)),
    ['s1', 's2', 's3', 's4', 'c1']
)

conferir(
    'o primeiro colocado nunca é trocado — seria entregar servico no lugar do melhor fato',
    reservarVagaParaProcedimento(afogado.slice(0, 5), afogado, 5, CENARIO)[0].id,
    's1'
)

const jaTem = [
    { id: 'c1', titulo: 'cenarios', tipo: CENARIO },
    { id: 's1', titulo: 'Home | site', tipo: 'website' },
]
conferir(
    'servico já entre os escolhidos: nada muda, e é o caso comum',
    ids(reservarVagaParaProcedimento(jaTem, jaTem, 5, CENARIO)),
    ['c1', 's1']
)

const semCenario = [
    { id: 's1', titulo: 'Home | site', tipo: 'website' },
    { id: 't1', titulo: 'servicos', tipo: 'treinamento' },
]
conferir(
    'a busca não achou servico nenhum: não há o que reservar',
    ids(reservarVagaParaProcedimento(semCenario, semCenario, 5, CENARIO)),
    ['s1', 't1']
)

/**
 * Sobrou vaga: o servico entra **sem tirar ninguém**. É o acervo pequeno,
 * em que a diversificação devolveu menos que o limite.
 */
const comVaga = [
    { id: 's1', titulo: 'Home | site', tipo: 'website' },
    { id: 's2', titulo: 'Produtos | site', tipo: 'website' },
    { id: 'c1', titulo: 'cenarios', tipo: CENARIO },
]
conferir(
    'com vaga livre, o servico entra sem custar nada a ninguém',
    ids(reservarVagaParaProcedimento(comVaga.slice(0, 2), comVaga, 5, CENARIO)),
    ['s1', 's2', 'c1']
)

conferir(
    'o melhor servico é o escolhido, não qualquer um',
    ids(
        reservarVagaParaProcedimento(
            [{ id: 's1', titulo: 'site', tipo: 'website' }],
            [
                { id: 's1', titulo: 'site', tipo: 'website' },
                { id: 'c7', titulo: 'cenarios', tipo: CENARIO },
                { id: 'c9', titulo: 'cenarios', tipo: CENARIO },
            ],
            2,
            CENARIO
        )
    ),
    ['s1', 'c7']
)

conferir('limite zero não inventa vaga', reservarVagaParaProcedimento(afogado.slice(0, 5), afogado, 0, CENARIO).length, 5)

/**
 * Trecho **sem** `tipo` não pode ser confundido com servico.
 *
 * O genérico é anotado à mão aqui, e isso não é estilo: sem a anotação o
 * `T` é inferido do primeiro argumento, cujos literais não declaram `tipo`, e o
 * resultado perde `id` — que é o que `ids()` lê. O `tsx` do `test:fusao` não
 * reclama (não checa tipo), e foi assim que este arquivo passou verde aqui e
 * derrubou o `tsc` do build.
 */
type CandidatoDeTeste = { id: string; titulo: string; tipo?: string | null }

const semTipo: CandidatoDeTeste[] = [
    { id: 'a', titulo: 'x' },
    { id: 'b', titulo: 'y' },
]

conferir(
    'trecho sem tipo nunca é confundido com servico',
    ids(reservarVagaParaProcedimento(semTipo.slice(0, 1), semTipo, 2, CENARIO)),
    ['a']
)

/**
 * A invariante que importa de verdade: a reserva **nunca** muda o tamanho da
 * resposta. Ela troca, não acrescenta — exceto quando havia vaga vazia.
 */
conferir(
    'o tamanho da resposta nunca passa do limite',
    reservarVagaParaProcedimento(afogado.slice(0, 5), afogado, 5, CENARIO).length,
    5
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
