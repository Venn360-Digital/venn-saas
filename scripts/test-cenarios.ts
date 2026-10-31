/**
 * Os cenários e a compactação — o passo 6.
 *
 *   npm run test:cenarios
 *
 * Duas propriedades valem mais que as outras:
 *
 *   - **o catálogo vai no prompt, o corpo não.** Vinte procedimentos num prompt
 *     que vai em toda mensagem seriam milhares de tokens para um agente que usa
 *     dois por dia. O que o teste protege é que `catalogoDeCenarios` devolve
 *     título e gatilho, e **nunca** os passos.
 *   - **procedimento não é fato.** Um fato recuperado é fonte de verdade para
 *     responder; um procedimento é ordem de execução. Sem a distinção o modelo
 *     leria os passos *para* o paciente em vez de executá-los.
 */
import {
    MAX_NO_CATALOGO,
    catalogoDeCenarios,
    lerCenarios,
    procedimentoParaOPrompt,
} from '@/lib/treinamento/cenarios'
import {
    COMPACTAR_A_PARTIR_DE,
    RECALCULAR_A_CADA,
    precisaCompactar,
    resumoParaOPrompt,
    transcrever,
} from '@/lib/conversas/resumo'
import { acharDocumento, documentosDeFato, documentosDoAcervo, documentosDoPrompt } from '@/lib/treinamento/documentos'
import { buildSystemPrompt } from '@/trabalhos/servicos/prompt'
import type { Agent } from '#prisma'
import { tipoDoAcervo, ehDeTreinamento, TIPO_DE_CENARIO, TIPO_DE_TREINAMENTO } from '@/lib/treinamento/indexar'

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


/** O mínimo que `buildSystemPrompt` lê do agente. */
function agenteDeProva(): Agent {
    return {
        id: 'a',
        name: 'Agente',
        systemPrompt: 'base',
        timezone: 'America/Sao_Paulo',
        llmProvider: 'openai',
        llmModel: 'gpt-4o-mini',
        temperature: 0.5,
    } as unknown as Agent
}

const doc = `# Cenários de atendimento

## Cenários

### Paciente quer remarcar

Quando: o paciente pede para mudar data ou horário de consulta já marcada.

Passos:
1. Não remarque — você não faz isso.
2. Pergunte qual data ele prefere.
3. Chame passar_para_equipe com o pedido.

### Urgência ou dor

Quando: o paciente relata dor, sangramento ou inchaço.

Passos:
- Passe imediatamente para a equipe.
- Informe o telefone da clínica.

### Sem gatilho nenhum

Passos:
1. Isto não deveria valer.

### Sem passos

Quando: nunca.
`

console.log('\nLer os cenários')

const { cenarios, problemas } = lerCenarios(doc)

conferir('dois cenários válidos', cenarios.map((c) => c.titulo), ['Paciente quer remarcar', 'Urgência ou dor'])
conferir(
    'o gatilho é lido do "Quando:"',
    cenarios[0].quando,
    'o paciente pede para mudar data ou horário de consulta já marcada.'
)
conferir('os passos numerados são lidos, sem a numeração', cenarios[0].passos, [
    'Não remarque — você não faz isso.',
    'Pergunte qual data ele prefere.',
    'Chame passar_para_equipe com o pedido.',
])
conferir('passo com marcador também', cenarios[1].passos.length, 2)
conferir(
    'seção sem gatilho vira problema, não cenário',
    problemas.find((p) => p.titulo === 'Sem gatilho nenhum')?.motivo,
    'sem-quando'
)
conferir(
    'seção sem passos vira problema',
    problemas.find((p) => p.titulo === 'Sem passos')?.motivo,
    'sem-passos'
)
conferir(
    'o título do documento NÃO é acusado de cenário sem gatilho',
    problemas.some((p) => p.titulo === 'Cenários de atendimento'),
    false
)
conferir('documento vazio não produz nada', lerCenarios(''), { cenarios: [], problemas: [] })
conferir(
    'cabeçalho dentro de cerca de código não abre cenário fantasma',
    lerCenarios('## Real\nQuando: x\nPassos:\n1. a\n\n```\n## Falso\n```\n').cenarios.length,
    1
)

console.log('\nO catálogo estável')

const catalogo = catalogoDeCenarios(cenarios)!

conferir('traz os títulos', catalogo.includes('**Paciente quer remarcar**'), true)
conferir('traz o gatilho, em minúscula depois de "quando"', catalogo.includes('— quando o paciente pede'), true)
conferir(
    'NUNCA traz os passos — é o ponto do modo procedimento',
    catalogo.includes('Chame passar_para_equipe') || catalogo.includes('Informe o telefone'),
    false
)
conferir('diz ao modelo onde o procedimento aparece', catalogo.includes('Procedimento para esta situação'), true)
conferir('sem cenário válido devolve nulo, para a seção não sair vazia', catalogoDeCenarios([]), null)
conferir(
    'o catálogo tem teto — ele vai em toda mensagem',
    catalogoDeCenarios(
        Array.from({ length: MAX_NO_CATALOGO + 5 }, (_, i) => ({
            titulo: `c${i}`,
            quando: 'x',
            passos: ['a'],
        }))
    )!.split('\n').filter((l) => l.startsWith('- ')).length,
    MAX_NO_CATALOGO
)

console.log('\nO procedimento recuperado')

const proc = procedimentoParaOPrompt([{ title: 'cenarios', content: '### Remarcar\nPassos:\n1. a' }])!

conferir('manda EXECUTAR, não ler', proc.includes('Não os leia para o paciente'), true)
conferir('traz o corpo', proc.includes('Passos:'), true)
conferir('sem trecho devolve nulo', procedimentoParaOPrompt([]), null)

console.log('\nO catálogo e o acervo')

conferir('o oitavo documento existe', acharDocumento('cenarios')?.modo, 'procedimento')
conferir(
    'ele é indexado: entra em documentosDoAcervo',
    documentosDoAcervo().map((d) => d.slug).includes('cenarios'),
    true
)
conferir(
    'mas NÃO é documento de fato',
    documentosDeFato().map((d) => d.slug).includes('cenarios'),
    false
)
conferir(
    'e NÃO vai inteiro no prompt',
    documentosDoPrompt().map((d) => d.slug).includes('cenarios'),
    false
)
conferir('o trecho dele leva tipo próprio', tipoDoAcervo('procedimento'), TIPO_DE_CENARIO)
conferir('o de rag leva o de treinamento', tipoDoAcervo('rag'), TIPO_DE_TREINAMENTO)
conferir('os dois contam como de treinamento — o Cérebro não os lista nem os apaga', [
    ehDeTreinamento(TIPO_DE_TREINAMENTO),
    ehDeTreinamento(TIPO_DE_CENARIO),
    ehDeTreinamento('doc'),
], [true, true, false])
conferir(
    'a precedência dele fica entre os limites e os fatos',
    (acharDocumento('cenarios')!.precedencia > acharDocumento('privacidade')!.precedencia) &&
        (acharDocumento('cenarios')!.precedencia < acharDocumento('servicos')!.precedencia),
    true
)

console.log('\nComentário NÃO chega ao catálogo — era um furo aberto')

/**
 * Os documentos de modo `prompt` são limpos na montagem dos blocos de
 * treinamento. Cenários não passa por ali: ele chega cru ao construtor, de
 * propósito, para que só o catálogo saia dele. Até 2026-10-31 isso significava
 * que um comentário no `Quando:` entrava no **bloco estável e cacheado**, em
 * toda mensagem de toda conversa.
 *
 * `lerCenarios` captura a linha inteira do `Quando:`, então o teste tem de
 * passar pelo construtor de prompt, não só pelo leitor.
 */
const COM_COMENTARIO = `# Cenários

## Desconto

Quando: o cliente pede desconto <!-- confirmar: a partir de quanto -->

Passos:
1. Não prometa <!-- confirmar: qual o teto -->
`

const promptComCenario = buildSystemPrompt(
    agenteDeProva(),
    [],
    undefined,
    [],
    COM_COMENTARIO,
    null
)

conferir(
    'o texto do comentário NÃO chega ao prompt',
    promptComCenario.includes('a partir de quanto') || promptComCenario.includes('qual o teto'),
    false
)
conferir('nem o marcador', promptComCenario.includes('<!--'), false)
conferir(
    'e o gatilho chega limpo, sem o rabo do comentário',
    promptComCenario.includes('- **Desconto** — quando o cliente pede desconto'),
    true
)

console.log('\nCenários entra na precedência escrita')

/**
 * A lista saía de `documentosDoPrompt()`, que filtra modo `prompt`. Cenários é
 * `procedimento`, então não aparecia em posição nenhuma — enquanto o corpo dele
 * chega no bloco volátil, na posição de maior recência, dizendo "execute os
 * passos". Um procedimento pré-escrito era a instrução menos subordinada do
 * conjunto.
 */
const comPrecedencia = buildSystemPrompt(
    agenteDeProva(),
    [],
    undefined,
    [
        { slug: 'privacidade', content: '# Informações e privacidade\n\n## Limites clínicos\nNão diagnostique.' },
        { slug: 'processo-comercial', content: '# Processo comercial e políticas\n\n## Etapas do atendimento\nConduza.' },
    ],
    COM_COMENTARIO,
    null
)

const listaDePrecedencia = comPrecedencia
    .slice(comPrecedencia.indexOf('## Precedência'))
    .split('\n')
    .filter((l) => /^\d+\. /.test(l))
    .map((l) => l.replace(/^\d+\. /, ''))

conferir(
    'Cenários é nomeado na hierarquia, e fica entre os limites e o acervo',
    listaDePrecedencia,
    [
        'Informações e privacidade',
        'Processo comercial e políticas',
        'Cenários de atendimento',
        'A base de conhecimento consultada durante a conversa',
    ]
)

console.log('\nQuando compactar')

conferir('conversa curta não compacta', precisaCompactar({ total: 10, desdeOResumo: 10, temResumo: false }), false)
conferir(
    'no limiar, e sem resumo, compacta',
    precisaCompactar({ total: COMPACTAR_A_PARTIR_DE, desdeOResumo: COMPACTAR_A_PARTIR_DE, temResumo: false }),
    true
)
conferir(
    'uma abaixo do limiar NÃO compacta',
    precisaCompactar({ total: COMPACTAR_A_PARTIR_DE - 1, desdeOResumo: 99, temResumo: false }),
    false
)
conferir(
    'com resumo recente, não recalcula',
    precisaCompactar({ total: 50, desdeOResumo: RECALCULAR_A_CADA - 1, temResumo: true }),
    false
)
conferir(
    'com o intervalo cheio, recalcula',
    precisaCompactar({ total: 50, desdeOResumo: RECALCULAR_A_CADA, temResumo: true }),
    true
)
conferir('os dois números são declarados, não mágicos', [COMPACTAR_A_PARTIR_DE, RECALCULAR_A_CADA], [30, 10])

console.log('\nA transcrição')

const quando = new Date('2026-10-30T12:00:00Z')

conferir(
    'quem falou e o que falou',
    transcrever([
        { direction: 'inbound', content: 'oi', transcript: null, contentType: 'text', createdAt: quando },
        { direction: 'outbound', content: 'olá', transcript: null, contentType: 'text', createdAt: quando },
    ]),
    '2026-10-30 Paciente: oi\n2026-10-30 Clínica: olá'
)
conferir(
    'ÁUDIO entra pela transcrição — senão o resumo veria uma sequência de nada',
    transcrever([
        { direction: 'inbound', content: '🎵 Áudio', transcript: 'quanto custa', contentType: 'audio', createdAt: quando },
    ]),
    '2026-10-30 Paciente: quanto custa'
)
conferir(
    'mídia sem texto nem transcrição mostra o tipo',
    transcrever([
        { direction: 'inbound', content: null, transcript: null, contentType: 'image', createdAt: quando },
    ]),
    '2026-10-30 Paciente: [image]'
)
conferir('nada devolve vazio', transcrever([]), '')

console.log('\nO resumo no prompt')

const noPrompt = resumoParaOPrompt('Resumo: quer clareamento.\nPendências: - confirmar preço')!

conferir('tem cabeçalho próprio', noPrompt.startsWith('## O que já aconteceu nesta conversa'), true)
conferir('manda NÃO repetir o combinado como novidade', noPrompt.includes('não os repita'), true)
conferir('traz o texto', noPrompt.includes('quer clareamento'), true)
conferir('resumo vazio devolve nulo', resumoParaOPrompt(''), null)
conferir('nulo devolve nulo', resumoParaOPrompt(null), null)
conferir('só espaço devolve nulo', resumoParaOPrompt('   \n  '), null)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
