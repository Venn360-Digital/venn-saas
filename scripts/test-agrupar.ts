/**
 * A mineração de lacunas: o agrupamento e o rascunho.
 *
 *   npm run test:agrupar
 *
 * Duas propriedades valem mais que todas as outras aqui, e cada uma tem o seu
 * bloco:
 *
 *   - **determinismo.** A fila de aprovação não pode reordenar sozinha entre uma
 *     semana e outra. Agrupamento por líder depende da ordem de entrada, então a
 *     ordem é fixada dentro da função, não herdada do banco.
 *   - **a mineração não escreve a resposta.** A lacuna existe porque a resposta
 *     não está em lugar nenhum; um modelo que a escrevesse estaria inventando
 *     preço, horário ou prazo — e um instrutor aprovando vinte sugestões em
 *     sequência transformaria isso em fonte de verdade do agente.
 */
import {
    LIMIAR_DE_GRUPO,
    agrupar,
    cosseno,
    maisCentral,
    normalizarPergunta,
    ordenarPorDemanda,
    type LacunaParaAgrupar,
} from '@/lib/lacunas/agrupar'
import {
    ALVOS_POSSIVEIS,
    ALVO_PADRAO,
    interpretarRascunho,
    promptDoRascunho,
    somarAoDocumento,
    textoDoRascunho,
} from '@/lib/lacunas/rascunho'
import { semComentarios } from '@/lib/rag/secoes'

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

console.log('\nA forma canônica da pergunta')

conferir('minúsculas, sem acento, sem pontuação', normalizarPergunta('Quanto Custa?'), 'quanto custa')
conferir('acento sai', normalizarPergunta('é caro?'), 'e caro')
conferir('espaços colapsam', normalizarPergunta('  quanto    custa  '), 'quanto custa')
conferir(
    'duas escritas da mesma pergunta viram uma — e um embedding, não dois',
    normalizarPergunta('Quanto custa?') === normalizarPergunta('quanto custa'),
    true
)
conferir('número sobrevive', normalizarPergunta('custa R$ 180?'), 'custa r 180')
conferir('só pontuação vira vazio', normalizarPergunta('???'), '')

console.log('\nCosseno')

conferir('vetores iguais dão 1', Math.round(cosseno([1, 0], [1, 0])), 1)
conferir('ortogonais dão 0', cosseno([1, 0], [0, 1]), 0)
conferir('escala não importa', Math.round(cosseno([1, 1], [5, 5])), 1)
conferir('tamanhos diferentes dão 0 — o par NÃO agrupa, que é o desfecho seguro', cosseno([1], [1, 2]), 0)
conferir('vetor nulo dá 0, em vez de NaN', cosseno([0, 0], [1, 1]), 0)
conferir('vazio dá 0', cosseno([], []), 0)

console.log('\nO agrupamento')

/** Vetores à mão: duas direções bem separadas, e ruído pequeno dentro de cada. */
const preco = (n: number): number[] => [1, 0.01 * n, 0]
const horario = (n: number): number[] => [0, 0.01 * n, 1]

const itens: LacunaParaAgrupar[] = [
    { id: 'a', pergunta: 'quanto custa o clareamento', vetor: preco(1) },
    { id: 'b', pergunta: 'qual o valor do clareamento', vetor: preco(2) },
    { id: 'c', pergunta: 'clareamento e caro', vetor: preco(3) },
    { id: 'd', pergunta: 'que horas vocês abrem', vetor: horario(1) },
    { id: 'e', pergunta: 'funcionam no sabado', vetor: horario(2) },
]

const grupos = agrupar(itens)

conferir('dois assuntos, dois grupos', grupos.length, 2)
conferir(
    'o grupo de preço tem os três',
    grupos.find((g) => g.ids.includes('a'))?.ids,
    ['a', 'b', 'c']
)
conferir(
    'o de horário tem os dois',
    grupos.find((g) => g.ids.includes('d'))?.ids,
    ['d', 'e']
)
conferir(
    'DETERMINISMO: a ordem de entrada não muda o resultado',
    JSON.stringify(agrupar([...itens].reverse())),
    JSON.stringify(grupos)
)
conferir(
    'e duas execuções sobre o mesmo dado dão o mesmo',
    JSON.stringify(agrupar(itens)),
    JSON.stringify(grupos)
)
conferir('lista vazia dá zero grupos', agrupar([]), [])
conferir(
    'uma lacuna só vira um grupo de demanda 1',
    agrupar([{ id: 'x', pergunta: 'p', vetor: [1, 0] }]),
    [{ representante: { id: 'x', pergunta: 'p', vetor: [1, 0] }, ids: ['x'], demanda: 1 }]
)
conferir(
    'limiar inalcançável separa tudo — e separar demais é o erro CERTO: dois grupos parecidos o instrutor percebe',
    // 1,1 e não 0,999: o cosseno nunca passa de 1, então isto prova a
    // propriedade sem depender de quão próximos estão os vetores desta prova —
    // `preco(1)` e `preco(2)` ficam em 0,99995, acima de 0,999.
    agrupar(itens, 1.1).length,
    5
)
conferir(
    'e o limiar de verdade fica entre os dois: estes vetores de preço ficam acima dele',
    cosseno(preco(1), preco(2)) > LIMIAR_DE_GRUPO,
    true
)
conferir('limiar baixo junta tudo', agrupar(itens, -1).length, 1)
conferir(
    'compara com o LÍDER, não com todos: a cadeia A~B~C com A≁C não funde os extremos',
    agrupar(
        [
            { id: 'p', pergunta: 'a', vetor: [1, 0, 0] },
            { id: 'q', pergunta: 'b', vetor: [0.9, 0.44, 0] },
            { id: 'r', pergunta: 'c', vetor: [0, 1, 0] },
        ],
        0.85
    ).length,
    2
)

console.log('\nQuem representa o grupo')

conferir(
    'o mais central, não o primeiro nem o mais curto',
    maisCentral([
        { id: 'a', pergunta: 'extremo de um lado', vetor: [1, 0] },
        { id: 'b', pergunta: 'no meio', vetor: [1, 1] },
        { id: 'c', pergunta: 'extremo do outro', vetor: [0, 1] },
    ]).id,
    'b'
)
conferir(
    'grupo de um devolve o único',
    maisCentral([{ id: 'so', pergunta: 'p', vetor: [1] }]).id,
    'so'
)

console.log('\nA ordem da fila')

conferir(
    'mais demanda primeiro',
    ordenarPorDemanda(grupos).map((g) => g.demanda),
    [3, 2]
)
conferir(
    'empate de demanda desempata pelo id, para a ordem ser reprodutível',
    ordenarPorDemanda([
        { representante: { id: 'z', pergunta: 'z', vetor: [1] }, ids: ['z'], demanda: 1 },
        { representante: { id: 'a', pergunta: 'a', vetor: [1] }, ids: ['a'], demanda: 1 },
    ]).map((g) => g.representante.id),
    ['a', 'z']
)

console.log('\nO prompt do rascunho')

const grupoDePreco = grupos.find((g) => g.ids.includes('a'))!
const prompt = promptDoRascunho(grupoDePreco, ['quanto custa o clareamento', 'qual o valor'])

conferir('diz quantas pessoas perguntaram', prompt.includes('3 pessoa(s)'), true)
conferir('lista as formas usadas', prompt.includes('- qual o valor'), true)
conferir('oferece só os documentos de conteúdo (faq e servicos), independente do modo', ALVOS_POSSIVEIS.sort().join(','), 'faq,servicos')
conferir('e o padrão é a FAQ', ALVO_PADRAO, 'faq')
conferir(
    'documento de modo prompt NÃO é alvo — sugestão automática não mexe na precedência',
    ALVOS_POSSIVEIS.includes('instrucoes-centrais') || ALVOS_POSSIVEIS.includes('privacidade'),
    false
)
conferir('PROÍBE escrever a resposta', prompt.includes('Não escreva a resposta'), true)
conferir(
    'e nomeia as quatro coisas que ele nunca escreve',
    ['preço', 'valor', 'horário', 'prazo'].every((p) => prompt.includes(p)),
    true
)

console.log('\nLer a saída do modelo')

const boa = 'ALVO: servicos\nSECAO: ## Quanto custa o clareamento?\nVARIACOES: qual o valor; é caro'

conferir('a forma pedida', interpretarRascunho(boa), {
    alvo: 'servicos',
    secao: '## Quanto custa o clareamento?',
    variacoes: ['qual o valor', 'é caro'],
})
conferir(
    'o nível do cabeçalho é garantido aqui, não pedido ao modelo',
    interpretarRascunho('ALVO: faq\nSECAO: #### pergunta\nVARIACOES:')?.secao,
    '## pergunta'
)
conferir(
    'sem cerquilha também vira ##',
    interpretarRascunho('ALVO: faq\nSECAO: pergunta\nVARIACOES:')?.secao,
    '## pergunta'
)
conferir(
    'alvo inventado é RECUSADO — gravaria rascunho em documento que não existe',
    interpretarRascunho('ALVO: instrucoes-centrais\nSECAO: ## p'),
    null
)
conferir('alvo ausente é recusado', interpretarRascunho('SECAO: ## p'), null)
conferir('seção ausente é recusada', interpretarRascunho('ALVO: faq'), null)
conferir(
    'seção só com cerquilha é recusada — poria um ## sem título no acervo',
    interpretarRascunho('ALVO: faq\nSECAO: ##'),
    null
)
conferir('saída solta é recusada', interpretarRascunho('acho que vai em faq'), null)
conferir(
    'variação curta demais é descartada',
    interpretarRascunho('ALVO: faq\nSECAO: ## p\nVARIACOES: ab; uma boa')?.variacoes,
    ['uma boa']
)

console.log('\nO texto do rascunho, e por que o branco é seguro')

const texto = textoDoRascunho(
    { alvo: 'faq', secao: '## Quanto custa o clareamento?', variacoes: ['qual o valor'] },
    3
)

conferir('tem o cabeçalho', texto.includes('## Quanto custa o clareamento?'), true)
conferir('tem os sinônimos no corpo, que é o que a busca encontra', texto.includes('qual o valor'), true)
conferir('tem o marcador de confirmar', texto.includes('<!-- confirmar:'), true)
conferir('diz a demanda dentro do marcador', texto.includes('3 pessoa(s)'), true)
conferir(
    'APROVADO SEM PREENCHER, o marcador NÃO chega ao acervo',
    semComentarios(texto).includes('confirmar'),
    false
)
conferir(
    'mas o cabeçalho e os sinônimos chegam',
    semComentarios(texto).includes('## Quanto custa o clareamento?') &&
        semComentarios(texto).includes('qual o valor'),
    true
)

console.log('\nJuntar ao documento')

conferir(
    'documento vazio recebe só o rascunho',
    somarAoDocumento('', '## nova\n'),
    '## nova\n'
)
conferir(
    'documento com texto recebe no FIM — não reordena o trabalho de quem escreveu',
    somarAoDocumento('# Doc\n\n## velha\ntexto', '## nova\n'),
    '# Doc\n\n## velha\ntexto\n\n## nova\n'
)
conferir(
    'espaço em branco no fim não acumula',
    somarAoDocumento('texto\n\n\n', '## nova\n'),
    'texto\n\n## nova\n'
)
conferir('o limiar é declarado, não mágico', LIMIAR_DE_GRUPO, 0.82)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
