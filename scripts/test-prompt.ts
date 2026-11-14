/**
 * Os casos da montagem do prompt com os documentos de treinamento.
 *
 *   npm run test:prompt
 *
 * É o texto que o modelo recebe antes de cada resposta — o artefato mais
 * consequente do sistema. Duas coisas aqui são invariantes, e as duas falham em
 * silêncio:
 *
 *   - **agente sem documento de treinamento não ganha seção nenhuma.** Isto sobe
 *     para contas que já atendem, e um agente que ainda não tem nenhum `.md`
 *     escrito não pode receber bloco novo por causa do método. (A **ordem** das
 *     seções mudou para todos, de propósito — ver o prefixo cacheável abaixo.)
 *   - **a precedência é dita.** Sem ela, "crie urgência" e "não prometa
 *     resultado" são resolvidos pela posição no texto, por acidente.
 *
 * `buildSystemPrompt` é pura: recebe o agente, os trechos, o contexto e os
 * documentos, e devolve texto. Não precisa de banco nem de modelo.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { buildSystemPrompt, type DocumentoNoPrompt } from '@venn/core/trabalhos/servicos/prompt'
import { acharDocumento } from '@venn/core/lib/treinamento/documentos'
import type { Agent } from '@venn/db'

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
        /**
         * Cenários entrou na hierarquia em 2026-10-31, e isto era uma falta.
         *
         * Ele é modo `procedimento`, então não saía de `documentosDoPrompt()` e
         * **não aparecia em posição nenhuma** — enquanto o corpo dele chega no
         * bloco volátil, na posição de maior recência, dizendo "execute os
         * passos". Um procedimento pré-escrito era a instrução menos
         * subordinada do conjunto. Entra pela precedência 4 do catálogo, sem o
         * texto: no prompt dele continua só o catálogo de títulos e gatilhos.
         */
        acharDocumento('cenarios')!.titulo,
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

console.log('\nO prefixo cacheável — a razão da ordem')

/**
 * Estes casos existem porque o desconto do provedor para no **primeiro byte que
 * muda**: tudo depois dele é cobrado cheio, mesmo sendo idêntico. Antes da
 * reordenação as duas seções voláteis ficavam no meio, com três estáveis atrás —
 * então nada era reaproveitado, nem os documentos de treinamento, que num
 * cliente real passam de 50.000 caracteres.
 *
 * Não se testa isso olhando a posição das seções, e sim a propriedade: dois
 * prompts do mesmo agente que diferem **só** no que é volátil têm de compartilhar
 * um prefixo que já contenha o treinamento inteiro.
 */
const contextoBase = {
    contactId: 'c1',
    upcoming: [],
    stages: ['Novo', 'Qualificado', 'Fechado'],
    bookable: { procedimentos: ['Limpeza'], especialistas: ['Dra. Ana'] },
}

const TREINO = 'Nunca prometer resultado de tratamento.'
const docsDoTeste = [doc(PRIVACIDADE, `## Limites\n\n${TREINO}`)]

const agenteCompleto = agenteDeTeste({ companyAddress: 'Av. Afonso Pena, 1500' })

const primeira = buildSystemPrompt(
    agenteCompleto,
    [{ title: 'servicos', content: 'Ortodontia a partir de R$ 180.' }],
    { ...contextoBase, agora: 'quinta-feira, 29/10/2026 às 09:00', contactFirstName: 'João', contactFullName: 'João Silva' },
    docsDoTeste
)

// Mesma conta, mesmo agente, mensagem seguinte: o relógio andou, a busca trouxe
// outro trecho, e o negócio mudou de fase. Nada do cadastro mudou.
const segunda = buildSystemPrompt(
    agenteCompleto,
    [{ title: 'faq', content: 'Atendemos convênio Unimed.' }],
    { ...contextoBase, agora: 'quinta-feira, 29/10/2026 às 11:42', contactFirstName: 'João', contactFullName: 'João Silva', dealStage: 'Qualificado' },
    docsDoTeste
)

function prefixoComum(a: string, b: string): string {
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return a.slice(0, i)
}

const prefixo = prefixoComum(primeira, segunda)

conferir('os dois prompts de fato diferem', primeira === segunda, false)
conferir('o treinamento está no prefixo reaproveitado', prefixo.includes(TREINO), true)
conferir('a precedência também', prefixo.includes('## Precedência'), true)
conferir('e o cadastro da empresa', prefixo.includes('Av. Afonso Pena, 1500'), true)
conferir('as fases do funil, que são da conta', prefixo.includes('## O que você pode fazer'), true)
conferir('o que pode ser agendado, que é cadastro', prefixo.includes('## Agendamento'), true)
conferir('o formato fecha o prefixo', prefixo.includes('## Formato'), true)
conferir('e a instrução de recuo também é prefixo', prefixo.includes('## Quando não souber'), true)

// O que NÃO pode estar no prefixo: se estivesse, seria porque não muda — e aí o
// agente estaria respondendo com o relógio ou o acervo da mensagem anterior.
conferir('o relógio fica fora do prefixo', prefixo.includes('09:00'), false)
conferir('o trecho recuperado fica fora', prefixo.includes('Ortodontia a partir de R$ 180.'), false)

/**
 * Nenhuma seção estável pode ficar depois de uma volátil. É a mesma regra vista
 * por fora: se uma `push` for para a lista errada, isto quebra.
 */
const inicioDoVolatil = Math.min(
    ...['## Esta conversa', '## Base de conhecimento']
        .map((s) => primeira.indexOf(s))
        .filter((i) => i >= 0)
)
const estaveisDepois = [
    '## Empresa',
    '## Estilo de comunicação',
    '## O que você pode fazer',
    '## Agendamento',
    '## Formato',
    '## Quando não souber',
].filter((s) => primeira.indexOf(s) > inicioDoVolatil)

conferir('nenhuma seção estável depois do volátil', estaveisDepois, [])

// E o acervo é a última coisa antes da pergunta, que é onde ele é mais usado.
conferir('a base de conhecimento é a última seção', primeira.trimEnd().endsWith('Ortodontia a partir de R$ 180.'), true)

/**
 * A instrução de recuo existe **justamente quando a busca não trouxe nada**.
 *
 * Era o inverso: a única frase de recuo do sistema vivia dentro de `## Base de
 * conhecimento`, que só é emitida quando há trecho recuperado. No caso em que o
 * recuo mais importa — acervo vazio, pergunta sem resposta em lugar nenhum — o
 * modelo não recebia instrução nenhuma e decidia sozinho o que dizer.
 *
 * Invisível porque o agente responde de qualquer jeito. Só responde inventando.
 */
console.log('\nO recuo quando não se sabe — existe com ou sem acervo')

const semAcervo = buildSystemPrompt(agenteDeTeste(), [], undefined, [])
const comAcervo = buildSystemPrompt(
    agenteDeTeste(),
    [{ title: 'servicos', content: 'Ortodontia a partir de R$ 180.' }],
    undefined,
    []
)

conferir('sem trecho recuperado, a instrução de recuo está lá', semAcervo.includes('## Quando não souber'), true)
conferir('e proíbe inventar valor, horário e prazo', semAcervo.includes('Nunca invente valor, horário, prazo'), true)
conferir('com trecho recuperado, continua lá', comAcervo.includes('## Quando não souber'), true)
conferir(
    'a seção de acervo não carrega mais o recuo — ele não é mais condicional',
    comAcervo.includes('diga que vai verificar em vez de inventar'),
    false
)
/**
 * **Nomear a ferramenta, e não só pedir a frase.**
 *
 * Esta prova checava `'passar o atendimento para a equipe'` — o texto antigo, que
 * mandava o agente *dizer* que ia passar. Dizer sem chamar deixava o paciente
 * esperando alguém que não foi avisado: a conversa não era entregue, nenhuma nota
 * aparecia para a equipe, e o agente respondia a mensagem seguinte normalmente.
 * Agora existe `passar_para_equipe`, e o que o prompt precisa garantir é que o
 * modelo saiba chamá-la.
 */
conferir(
    'o fallback manda CHAMAR a ferramenta de entrega, não só prometê-la',
    semAcervo.includes('passar_para_equipe'),
    true
)
conferir(
    'e a seção própria das três ferramentas de atendimento é estável',
    semAcervo.includes('## Quando a conversa passa de você') &&
        semAcervo.includes('nao_encontrei') &&
        semAcervo.includes('anotar_paciente'),
    true
)

/**
 * ## Passo 6: o catálogo é estável, o resumo é volátil
 *
 * As duas metades do prompt não são arrumação — é o cache de prefixo. O catálogo
 * de cenários **tem** de ficar no prefixo, senão ele é cobrado cheio em toda
 * mensagem; o resumo **tem** de ficar na cauda, senão cada compactação invalida
 * o cache de tudo que vem depois dela.
 *
 * E a ordem relativa importa pelo conteúdo, não só pelo preço: o resumo é o
 * passado, e vem antes de tudo que fala do agora.
 */
const CENARIOS = `# Cenários

## Remarcação

Quando: o paciente quer mudar a data.

Passos:
1. Não remarque.
2. Passe para a equipe.
`

const comCenarios = buildSystemPrompt(agenteDeTeste(), [], undefined, [], CENARIOS, null)

conferir('o catálogo de cenários entra', comCenarios.includes('## Cenários disponíveis'), true)
conferir('com o título e o gatilho', comCenarios.includes('**Remarcação** — quando o paciente quer mudar a data.'), true)
conferir(
    'e SEM os passos — é o ponto inteiro do modo procedimento',
    comCenarios.includes('Passe para a equipe'),
    false
)
conferir(
    'sem documento de cenário, nenhuma seção aparece',
    buildSystemPrompt(agenteDeTeste(), [], undefined, [], null, null).includes('## Cenários disponíveis'),
    false
)

const comResumo = buildSystemPrompt(
    agenteDeTeste(),
    [{ title: 'servicos', content: 'preço', type: 'treinamento' }],
    undefined,
    [],
    CENARIOS,
    'Resumo: quer clareamento.'
)

conferir('o resumo entra', comResumo.includes('## O que já aconteceu nesta conversa'), true)
conferir(
    'CATÁLOGO antes do RESUMO: o estável é prefixo, o volátil é cauda',
    comResumo.indexOf('## Cenários disponíveis') < comResumo.indexOf('## O que já aconteceu'),
    true
)
conferir(
    'e o resumo antes do acervo: o passado vem antes do agora',
    comResumo.indexOf('## O que já aconteceu') < comResumo.indexOf('## Base de conhecimento'),
    true
)

const comProcedimento = buildSystemPrompt(
    agenteDeTeste(),
    [
        { title: 'servicos', content: 'o preço é X', type: 'treinamento' },
        { title: 'cenarios', content: 'Passos:\n1. passe para a equipe', type: 'cenario' },
    ],
    undefined,
    []
)

conferir(
    'trecho de cenário vai para a seção de PROCEDIMENTO, não para a de fato',
    comProcedimento.includes('## Procedimento para esta situação'),
    true
)
conferir(
    'e manda executar, não ler para o paciente',
    comProcedimento.includes('Não os leia para o paciente'),
    true
)
conferir(
    'o fato continua na base de conhecimento',
    comProcedimento.includes('## Base de conhecimento') && comProcedimento.includes('o preço é X'),
    true
)
conferir(
    'PROCEDIMENTO antes de FATO: senão o modelo responde o preço e ignora o passo a passo',
    comProcedimento.indexOf('## Procedimento para esta situação') <
        comProcedimento.indexOf('## Base de conhecimento'),
    true
)

console.log('\nFormato: padrão nosso, precedência da empresa')

const formato = buildSystemPrompt(agenteDeTeste())

conferir(
    'a seção Formato existe e é estável',
    formato.includes('## Formato') && formato.includes('conversando pelo WhatsApp'),
    true
)
conferir(
    'ensina o negrito do WhatsApp — asterisco simples',
    formato.includes('*um asterisco de cada lado*'),
    true
)
conferir(
    'avisa que dois asteriscos aparecem literais',
    formato.includes('literais na tela de quem lê'),
    true
)
conferir(
    'declara que as instruções da empresa ganham desta seção',
    formato.includes('as instruções da empresa ganham dela'),
    true
)
conferir(
    'NÃO proíbe markdown: proibir contradizia o cliente que pede negrito e marcadores',
    formato.includes('sem markdown'),
    false
)
conferir(
    'o Formato vem ANTES de Quando não souber — as duas são do fim do estável',
    formato.indexOf('## Formato') < formato.indexOf('## Quando não souber'),
    true
)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)

/**
 * **Faltava o código de saída, e sem ele esta prova não derrubava nada.**
 *
 * Todos os outros `scripts/test-*.ts` terminam assim; este não terminava. O
 * efeito é o pior que um verificador pode ter: ele reprovava, imprimia `XX` na
 * saída, e o CI seguia **verde** — porque `npm run` só olha o código de saída.
 * Descoberto em 2026-10-31, quando a prova da precedência reprovou de verdade e
 * o `exit` veio 0.
 */
process.exit(falhou > 0 ? 1 : 0)
