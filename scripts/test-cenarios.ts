/**
 * Os cenários e a compactação — o passo 6.
 *
 *   npm run test:cenarios
 *
 * Duas propriedades valem mais que as outras:
 *
 *   - **o catálogo vai no prompt, o corpo não.** Vinte servicos num prompt
 *     que vai em toda mensagem seriam milhares de tokens para um agente que usa
 *     dois por dia. O que o teste protege é que `catalogoDeCenarios` devolve
 *     título e gatilho, e **nunca** os passos.
 *   - **servico não é fato.** Um fato recuperado é fonte de verdade para
 *     responder; um servico é ordem de execução. Sem a distinção o modelo
 *     leria os passos *para* o paciente em vez de executá-los.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    MAX_NO_CATALOGO,
    catalogoDeCenarios,
    lerCenarios,
    servicoParaOPrompt,
} from '@venn/core/lib/treinamento/cenarios'
import {
    COMPACTAR_A_PARTIR_DE,
    RECALCULAR_A_CADA,
    precisaCompactar,
    resumoParaOPrompt,
    transcrever,
} from '@venn/core/lib/conversas/resumo'
import { acharDocumento, documentosDeFato, documentosDoAcervo, documentosDoPrompt } from '@venn/core/lib/treinamento/documentos'
import { buildSystemPrompt } from '@venn/core/trabalhos/servicos/prompt'
import type { Agent } from '@venn/db'
import { tipoDoAcervo, ehDeTreinamento, TIPO_DE_CENARIO, TIPO_DE_TREINAMENTO } from '@venn/core/lib/treinamento/indexar'
import { BRAND } from '@venn/core/marca'
import { comArtigo } from '@venn/core/lib/concordancia'

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
    'NUNCA traz os passos — é o ponto do modo servico',
    catalogo.includes('Chame passar_para_equipe') || catalogo.includes('Informe o telefone'),
    false
)
conferir(
    'diz ao modelo onde o passo a passo aparece',
    catalogo.includes(`${BRAND().vocabulario.Servico} para esta situação`),
    true
)
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

console.log('\nO servico recuperado')

const proc = servicoParaOPrompt([{ title: 'cenarios', content: '### Remarcar\nPassos:\n1. a' }])!

conferir('manda EXECUTAR, não ler', proc.includes(`Não os leia para ${comArtigo(BRAND().vocabulario, 'pessoa')}`), true)
conferir('traz o corpo', proc.includes('Passos:'), true)
conferir('sem trecho devolve nulo', servicoParaOPrompt([]), null)

console.log('\nO catálogo e o acervo')

conferir('o oitavo documento existe', acharDocumento('cenarios')?.modo, 'servico')
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
conferir('o trecho dele leva tipo próprio', tipoDoAcervo('servico'), TIPO_DE_CENARIO)
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
 * `servico`, então não aparecia em posição nenhuma — enquanto o corpo dele
 * chega no bloco volátil, na posição de maior recência, dizendo "execute os
 * passos". Um servico pré-escrito era a instrução menos subordinada do
 * conjunto.
 */
const comPrecedencia = buildSystemPrompt(
    agenteDeProva(),
    [],
    undefined,
    [
        {
            slug: 'privacidade',
            content: `# ${acharDocumento('privacidade')!.titulo}\n\n## Limites clínicos\nNão diagnostique.`,
        },
        {
            slug: 'processo-comercial',
            content: `# ${acharDocumento('processo-comercial')!.titulo}\n\n## Etapas do atendimento\nConduza.`,
        },
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
        // Derivados do catálogo: o título na tela muda — o de
        // `processo-comercial` mudou em 2026-11-05 —, e o que este caso tem a
        // dizer é a ORDEM, não qual é o nome de cada um.
        acharDocumento('privacidade')!.titulo,
        acharDocumento('processo-comercial')!.titulo,
        acharDocumento('cenarios')!.titulo,
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

/*
 * Os rótulos vêm do VOCABULÁRIO, não de literais.
 *
 * A transcrição é o que o modelo lê para resumir a conversa, e quem falou é
 * dito com a palavra do nicho — num app de viagem o modelo precisa ler
 * "Cliente:", não "Paciente:". Escrever o literal esperado aqui prenderia o
 * teste ao primeiro nicho e, pior, aprovaria um código que também o prendesse.
 * Derivado, ele reprova se o rótulo deixar de seguir o vocabulário.
 */
const QUEM_ENTRA = BRAND().vocabulario.Pessoa
const QUEM_RESPONDE = BRAND().vocabulario.Organizacao

conferir(
    'quem falou e o que falou',
    transcrever([
        { direction: 'inbound', content: 'oi', transcript: null, contentType: 'text', createdAt: quando },
        { direction: 'outbound', content: 'olá', transcript: null, contentType: 'text', createdAt: quando },
    ]),
    `2026-10-30 ${QUEM_ENTRA}: oi\n2026-10-30 ${QUEM_RESPONDE}: olá`
)
conferir(
    'ÁUDIO entra pela transcrição — senão o resumo veria uma sequência de nada',
    transcrever([
        { direction: 'inbound', content: '🎵 Áudio', transcript: 'quanto custa', contentType: 'audio', createdAt: quando },
    ]),
    `2026-10-30 ${QUEM_ENTRA}: quanto custa`
)
conferir(
    'mídia sem texto nem transcrição mostra o tipo',
    transcrever([
        { direction: 'inbound', content: null, transcript: null, contentType: 'image', createdAt: quando },
    ]),
    `2026-10-30 ${QUEM_ENTRA}: [image]`
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

console.log('\nA seção reservada de exemplos não produz cenário')

/**
 * **Medido com documento real, e era grave.**
 *
 * `lerCenarios` identificava cenário por ter `Quando:` e `Passos:`, o que é
 * certo no corpo do documento. Na seção reservada de exemplos, não: ali o
 * cliente escreve "assim respondemos quando X", que é ilustração.
 *
 * Sem a exclusão, o exemplo abaixo entrava no catálogo do prompt estável como
 * cenário de verdade — e "Ofereça 20% de desconto à vista", que o cliente
 * escreveu para ilustrar o jeito de falar, virava ordem a executar em toda
 * conversa que casasse com o gatilho.
 *
 * É a mesma classe do defeito que `exemplos.ts` conserta no acervo, entrando
 * pela porta do prompt.
 */
{
    const comExemploNoFormato = [
        '# Cenários de atendimento',
        '',
        '## Cenários',
        '',
        '### Pede para falar com uma pessoa',
        '',
        'Quando: a pessoa pede atendente.',
        'Passos:',
        '1. Chame passar_para_equipe.',
        '',
        '## Exemplos de resposta',
        '',
        '### Como respondemos quando pedem desconto',
        '',
        'Quando: a pessoa pede desconto.',
        'Passos:',
        '1. Ofereça 20% de desconto à vista.',
    ].join('\n')

    const { cenarios, problemas } = lerCenarios(comExemploNoFormato)

    conferir('só o cenário de verdade é lido', cenarios.map((c) => c.titulo), [
        'Pede para falar com uma pessoa',
    ])
    conferir('e o exemplo não vira problema tampouco', problemas, [])
    conferir(
        'a política do exemplo não chega ao prompt',
        (catalogoDeCenarios(cenarios) ?? '').includes('desconto'),
        false
    )
}

/**
 * E o caminho inteiro é conferido, não só a folha: o cenário falso é a
 * subseção, e quem é reservado é o cabeçalho acima dela. Aqui o exemplo está
 * dois níveis abaixo.
 */
conferir(
    'exemplo aninhado mais fundo também é ignorado',
    lerCenarios(
        [
            '## Exemplos de resposta',
            '### Agendamento',
            '#### Quando pedem horário',
            'Quando: pedem horário.',
            'Passos:',
            '1. Prometa terça às 14h.',
        ].join('\n')
    ),
    { cenarios: [], problemas: [] }
)

/**
 * O outro lado: cabeçalho que só *parece* de exemplo não some. "Exemplos de
 * atendimento" não tem a palavra `resposta`, então é seção comum — e um cenário
 * escrito ali continua valendo.
 */
conferir(
    'cabeçalho que não é a seção reservada continua produzindo cenário',
    lerCenarios(
        [
            '## Exemplos de atendimento',
            '### Pede humano',
            'Quando: pede atendente.',
            'Passos:',
            '1. Passe para a equipe.',
        ].join('\n')
    ).cenarios.map((c) => c.titulo),
    ['Pede humano']
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
