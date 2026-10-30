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
import { diversificarPorDocumento, fundirRRF, K_RRF, termosLexicais } from '@/lib/rag/fusao'

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

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
