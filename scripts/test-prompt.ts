/**
 * Os casos da montagem do prompt com os documentos de treinamento.
 *
 *   npm run test:prompt
 *
 * É o texto que o modelo recebe antes de cada resposta — o artefato mais
 * consequente do sistema. Duas coisas aqui são invariantes, e as duas falham em
 * silêncio:
 *
 *   - **agente sem documento de treinamento não muda de comportamento.** Esta
 *     mudança sobe para contas que já atendem, e um agente que ainda não tem
 *     nenhum `.md` escrito tem de receber o prompt de antes, sem seção nova.
 *   - **a precedência é dita.** Sem ela, "crie urgência" e "não prometa
 *     resultado" são resolvidos pela posição no texto, por acidente.
 *
 * `buildSystemPrompt` é pura: recebe o agente, os trechos, o contexto e os
 * documentos, e devolve texto. Não precisa de banco nem de modelo.
 */
import { buildSystemPrompt, type DocumentoNoPrompt } from '@/trabalhos/servicos/prompt'
import { acharDocumento } from '@/lib/treinamento/documentos'
import type { Agent } from '#prisma'

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

/** O mínimo que o construtor lê. O resto do Agent não é tocado por ele. */
function agenteDeTeste(extra: Partial<Agent> = {}): Agent {
    return {
        systemPrompt: 'Fale com acolhimento e vá direto ao ponto.',
        companyName: 'Clínica Teste',
        companySector: null,
        companyAddress: null,
        companyWebsite: null,
        companyDescription: null,
        agentFunction: null,
        jobDescription: null,
        voiceTone: null,
        language: 'pt-BR',
        preferences: null,
        ...extra,
    } as Agent
}

const CENTRAIS = 'instrucoes-centrais'
const PRIVACIDADE = 'privacidade'
const PROCESSO = 'processo-comercial'

const doc = (slug: string, content: string): DocumentoNoPrompt => ({ slug, content })

console.log('\nAgente SEM documento de treinamento — não pode mudar de comportamento')

const semNada = buildSystemPrompt(agenteDeTeste(), [], undefined, [])

conferir('não ganha seção de precedência', semNada.includes('## Precedência'), false)
conferir(
    'começa pela instrução livre, como antes',
    semNada.startsWith('Fale com acolhimento e vá direto ao ponto.'),
    true
)
conferir(
    'e o resultado é igual ao de quem nem passa o argumento',
    buildSystemPrompt(agenteDeTeste(), [], undefined),
    semNada
)
conferir(
    'documento presente mas VAZIO também não conta',
    buildSystemPrompt(agenteDeTeste(), [], undefined, [doc(PRIVACIDADE, '   \n\n')]),
    semNada
)
conferir(
    'documento que só tem comentário de HTML também não conta',
    buildSystemPrompt(agenteDeTeste(), [], undefined, [doc(PRIVACIDADE, '<!-- escrever depois -->')]),
    semNada
)

console.log('\nInstruções centrais SUBSTITUEM a instrução livre — não somam')

const comCentrais = buildSystemPrompt(agenteDeTeste(), [], undefined, [
    doc(CENTRAIS, '# Instruções centrais\n\nVocê é a Ana, da recepção.'),
])

conferir('o texto das centrais está no prompt', comCentrais.includes('Você é a Ana, da recepção.'), true)
conferir(
    'e a instrução livre NÃO está — duas identidades divergiriam',
    comCentrais.includes('Fale com acolhimento e vá direto ao ponto.'),
    false
)
conferir('as centrais abrem o prompt', comCentrais.startsWith('# Instruções centrais'), true)
conferir(
    'centrais só com comentário caem de volta na instrução livre',
    buildSystemPrompt(agenteDeTeste(), [], undefined, [
        doc(CENTRAIS, '<!-- ainda não escrevi -->'),
    ]).startsWith('Fale com acolhimento'),
    true
)

console.log('\nA precedência — o que resolve "crie urgência" x "não prometa resultado"')

const comTres = buildSystemPrompt(agenteDeTeste(), [], undefined, [
    doc(PROCESSO, '## Etapas\n\nQualificar, depois oferecer horário.'),
    doc(CENTRAIS, '## Identidade\n\nVocê é a Ana.'),
    doc(PRIVACIDADE, '## Limites clínicos\n\nNão prometer resultado.'),
])

conferir('a seção de precedência existe', comTres.includes('## Precedência'), true)

const listaDePrecedencia = (prompt: string) =>
    (prompt.match(/^\d+\. (.+)$/gm) ?? []).map((l) => l.replace(/^\d+\. /, ''))

conferir(
    'na ordem do catálogo, com o acervo em último',
    listaDePrecedencia(comTres),
    [
        acharDocumento(PRIVACIDADE)!.titulo,
        acharDocumento(CENTRAIS)!.titulo,
        acharDocumento(PROCESSO)!.titulo,
        'A base de conhecimento consultada durante a conversa',
    ]
)

conferir(
    'a ordem NÃO é a ordem em que os documentos chegaram',
    listaDePrecedencia(comTres)[0],
    acharDocumento(PRIVACIDADE)!.titulo
)

conferir(
    'diz que objetivo comercial não vence limite',
    comTres.includes('Nenhum objetivo comercial justifica contrariar um limite'),
    true
)

console.log('\nAs seções dos documentos')

conferir(
    'Privacidade vem com o título da tela',
    comTres.includes(`## ${acharDocumento(PRIVACIDADE)!.titulo}`),
    true
)
conferir(
    'Processo comercial também',
    comTres.includes(`## ${acharDocumento(PROCESSO)!.titulo}`),
    true
)
conferir(
    'as centrais NÃO ganham seção própria — elas abrem o prompt',
    comTres.includes(`## ${acharDocumento(CENTRAIS)!.titulo}\n`),
    false
)
conferir(
    'Privacidade aparece antes de Processo comercial no texto',
    comTres.indexOf(`## ${acharDocumento(PRIVACIDADE)!.titulo}`) <
        comTres.indexOf(`## ${acharDocumento(PROCESSO)!.titulo}`),
    true
)

console.log('\nComentário de HTML não entra como instrução')

const comComentario = buildSystemPrompt(agenteDeTeste(), [], undefined, [
    doc(PRIVACIDADE, '## Limites\n\nNão prometer prazo.\n\n<!-- confirmar com a recepção -->'),
])

conferir('o texto fica', comComentario.includes('Não prometer prazo.'), true)
conferir('a nota sai', comComentario.includes('confirmar com a recepção'), false)

console.log('\nO que já existia continua no lugar')

const completo = buildSystemPrompt(
    agenteDeTeste({ companyAddress: 'Av. Afonso Pena, 1500' }),
    [{ title: 'servicos', content: 'Ortodontia a partir de R$ 180.' }],
    undefined,
    [doc(PRIVACIDADE, '## Limites\n\nNão prometer resultado.')]
)

conferir('a seção Empresa segue lá', completo.includes('## Empresa'), true)
conferir('o endereço segue lá', completo.includes('Av. Afonso Pena, 1500'), true)
conferir('a base de conhecimento segue lá', completo.includes('## Base de conhecimento'), true)
conferir('o trecho recuperado segue lá', completo.includes('Ortodontia a partir de R$ 180.'), true)
conferir('e a seção de formato é a última', completo.trimEnd().endsWith('listas numeradas longas.'), true)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
