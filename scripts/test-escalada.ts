/**
 * Quando o agente não soube, e quando isso vira entrega à equipe.
 *
 *   npm run test:escalada
 *
 * A lacuna é a **conjunção** de dois sinais — busca fraca e resposta de quem não
 * sabia — e é essa conjunção que estes casos protegem. Cada sinal sozinho tem
 * falso positivo conhecido, e os dois mais perigosos estão aqui:
 *
 *   - "vou confirmar seu horário de segunda" é frase de um agente que **sabe** o
 *     que está fazendo, e não pode contar como lacuna;
 *   - pergunta de comportamento ("vocês atendem convênio?") é respondida pelas
 *     instruções, sem acervo nenhum — busca vazia com resposta boa não é lacuna.
 *
 * A escrita no banco é casca fina no processador do `ai-reply`; o que decide
 * está aqui, e é puro.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    LACUNAS_ATE_ESCALAR,
    areaDaDespedida,
    despedidaDaEntrega,
    deveEscalar,
    ehLacuna,
    melhorSimilaridade,
    pareceFallback,
} from '@venn/core/lib/atendimento/escalada'

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

const PISO = 0.35

console.log('\nA resposta é de quem não sabia?')

conferir(
    'a frase que o prompt pede: confirmar com a equipe',
    pareceFallback('Não tenho esse valor aqui. Vou confirmar com a equipe e te retorno, combinado?'),
    true
)
conferir(
    'sem acento, porque o modelo às vezes escreve assim',
    pareceFallback('vou verificar com a recepcao e ja retorno'),
    true
)
conferir('verbo com promessa de volta, sem destino', pareceFallback('Vou checar isso e te retorno hoje.'), true)
conferir('admissão direta', pareceFallback('Não tenho essa informação, desculpe.'), true)
conferir('admissão direta, outra forma', pareceFallback('Não sei informar o prazo exato.'), true)

conferir(
    'FALSO POSITIVO: confirmar um horário que o agente acabou de marcar',
    pareceFallback('Perfeito! Vou confirmar seu horário de segunda às 14h no sistema.'),
    false
)
conferir(
    'FALSO POSITIVO: pedir ao paciente que confirme',
    pareceFallback('Pode confirmar se o seu nome completo está certo?'),
    false
)
conferir('resposta boa, com fato', pareceFallback('A avaliação é gratuita e dura 40 minutos.'), false)
conferir('resposta vazia', pareceFallback(''), false)
conferir(
    'a despedida da entrega NÃO é fallback — é o fim, não o adiamento',
    pareceFallback(despedidaDaEntrega(true)),
    false
)

console.log('\nA melhor similaridade do conjunto')

conferir('nenhum trecho devolve nulo', melhorSimilaridade([]), null)
conferir('o maior ganha', melhorSimilaridade([{ similarity: 0.3 }, { similarity: 0.7 }, { similarity: 0.5 }]), 0.7)
conferir(
    'trecho sem similaridade é ignorado — é acerto só lexical',
    melhorSimilaridade([{}, { similarity: 0.42 }]),
    0.42
)
conferir(
    'só acerto lexical devolve nulo, e isso conta como busca fraca',
    melhorSimilaridade([{}, {}]),
    null
)

console.log('\nIsto foi uma lacuna?')

conferir(
    'busca vazia e resposta de adiamento: lacuna',
    ehLacuna({ trechos: [], piso: PISO, resposta: 'Vou confirmar com a equipe e te retorno.' }),
    true
)
conferir(
    'busca abaixo do piso e resposta de adiamento: lacuna',
    ehLacuna({
        trechos: [{ similarity: 0.2 }],
        piso: PISO,
        resposta: 'Não tenho essa informação, vou verificar com a equipe.',
    }),
    true
)
conferir(
    'só acerto lexical, sem vetor: conta como busca fraca',
    ehLacuna({ trechos: [{}], piso: PISO, resposta: 'Vou confirmar com a equipe.' }),
    true
)
conferir(
    'busca vazia e resposta BOA: não é lacuna — respondeu pelas instruções',
    ehLacuna({ trechos: [], piso: PISO, resposta: 'Sim, atendemos de segunda a sexta.' }),
    false
)
conferir(
    'busca FORTE e resposta de adiamento: não é lacuna automática — é caso de nao_encontrei',
    ehLacuna({
        trechos: [{ similarity: 0.72 }],
        piso: PISO,
        resposta: 'Vou confirmar com a equipe e te retorno.',
    }),
    false
)
conferir(
    'exatamente no piso NÃO é fraca: o piso é o que o atendimento aceita',
    ehLacuna({ trechos: [{ similarity: PISO }], piso: PISO, resposta: 'Vou confirmar com a equipe.' }),
    false
)
conferir(
    'o piso vem de fora: com piso alto, o mesmo trecho vira lacuna',
    ehLacuna({ trechos: [{ similarity: 0.5 }], piso: 0.8, resposta: 'Vou confirmar com a equipe.' }),
    true
)

console.log('\nEscalar agora?')

conferir('a primeira lacuna não escala — prometer confirmação é o comportamento pedido', deveEscalar({ lacunasNoAtendimento: 1, jaEntregue: false }), false)
conferir('a segunda escala', deveEscalar({ lacunasNoAtendimento: LACUNAS_ATE_ESCALAR, jaEntregue: false }), true)
conferir('a terceira também, se escapou da segunda', deveEscalar({ lacunasNoAtendimento: 5, jaEntregue: false }), true)
conferir(
    'já entregue NÃO reentrega, nem com muitas lacunas',
    deveEscalar({ lacunasNoAtendimento: 9, jaEntregue: true }),
    false
)
conferir('zero lacunas nunca escala', deveEscalar({ lacunasNoAtendimento: 0, jaEntregue: false }), false)

console.log('\nA despedida')

conferir(
    'com responsável, promete que alguém responde',
    despedidaDaEntrega(true).includes('alguém vai te responder'),
    true
)
conferir(
    'sem responsável, não promete pessoa — promete a equipe',
    despedidaDaEntrega(false).includes('alguém vai te responder'),
    false
)
conferir('as duas falam em equipe', despedidaDaEntrega(true).includes('equipe') && despedidaDaEntrega(false).includes('equipe'), true)

console.log('\nA área citada na despedida')

conferir(
    'a área entra na frase, com o artigo que o modelo escreveu',
    despedidaDaEntrega(true, 'o especialista do produto'),
    'Já passei seu atendimento para o especialista do produto — alguém vai te responder por aqui.'
)
conferir(
    'sem responsável, a área entra na outra variante',
    despedidaDaEntrega(false, 'o gerente'),
    'Já passei seu atendimento para o gerente, que continua por aqui com você.'
)
conferir('área ausente cai no genérico', despedidaDaEntrega(true), 'Já passei seu atendimento para a nossa equipe — alguém vai te responder por aqui.')
conferir('área vazia cai no genérico', despedidaDaEntrega(true, '   '), 'Já passei seu atendimento para a nossa equipe — alguém vai te responder por aqui.')

conferir('espaço repetido e quebra de linha são normalizados', areaDaDespedida('o  vendedor\n especializado'), 'o vendedor especializado')
conferir('área acima do teto é recusada', areaDaDespedida('o'.padEnd(61, 'o')), null)

conferir('"um atendente humano" é recusada — é o que a entrega não pode revelar', areaDaDespedida('um atendente humano'), null)
conferir('"o time de IA" é recusada', areaDaDespedida('o time de IA'), null)
conferir('"o assistente virtual" é recusada', areaDaDespedida('o assistente virtual'), null)
conferir('"o robô do financeiro" é recusada', areaDaDespedida('o robô do financeiro'), null)
conferir('"o bot de vendas" é recusada', areaDaDespedida('o bot de vendas'), null)

conferir('"a assistência técnica" passa: "ia" no meio da palavra não conta', areaDaDespedida('a assistência técnica'), 'a assistência técnica')
conferir('"o setor financeiro" passa', areaDaDespedida('o setor financeiro'), 'o setor financeiro')
conferir('"o especialista em telas" passa', areaDaDespedida('o especialista em telas'), 'o especialista em telas')

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
