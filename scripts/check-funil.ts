/**
 * Prova as decisões do funil, sem banco e sem Cloudflare.
 *
 *     npm run check:funil
 *
 * ## Por que isto é o teste que mais importa deste módulo
 *
 * O runtime do funil vive num Cloudflare Workflow, e **o workerd não roda
 * nesta máquina** (ver CLAUDE.md). Se a navegação, a espera e os freios
 * morassem dentro do `WorkflowEntrypoint`, nada disso poderia ser exercitado
 * antes de staging — e um erro de navegação só apareceria como "a sequência
 * mandou a mensagem errada", dias depois, no relato de um paciente.
 *
 * Por isso a decisão é pura (`src/lib/funil/passos.ts`) e o `WorkflowEntrypoint`
 * é casca fina. É a mesma separação dos Durable Objects do projeto.
 */
import {
    canalDoPasso,
    cicloNoDesenho,
    deveParar,
    ESPERA_MAX_MIN,
    lerCondicao,
    MAX_TRANSICOES,
    minutosDeEspera,
    primeiroPasso,
    proximoPasso,
    sucessores,
    type PassoDoFunil,
} from '../src/lib/funil/passos'
import { casa, lerGatilho, TIPOS_DE_GATILHO } from '../src/lib/funil/gatilho'
import { MAX_PASSOS, podePublicar } from '../src/lib/funil/publicar'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

const passo = (id: string, order: number, edges: unknown = null, type = 'mensagem'): PassoDoFunil => ({
    id,
    type,
    config: {},
    order,
    edges,
})

// ═════════════════════════════ A navegação ═════════════════════════════

console.log('── Qual passo vem depois ──')

const linear = [passo('a', 0), passo('b', 1), passo('c', 2)]
ok('o primeiro é o de menor ordem', primeiroPasso(linear)?.id === 'a')
ok('sem aresta, segue a ordem', proximoPasso(linear[0], linear)?.id === 'b')
ok('o último termina', proximoPasso(linear[2], linear) === null)
ok('funil vazio não tem primeiro', primeiroPasso([]) === null)

/** A ordem no array não importa — o que vale é o campo `order`. */
const embaralhado = [passo('c', 2), passo('a', 0), passo('b', 1)]
ok('a ordem do array não confunde', primeiroPasso(embaralhado)?.id === 'a')
ok('nem a navegação', proximoPasso(embaralhado[1], embaralhado)?.id === 'b')

console.log('')
console.log('── A aresta vence a ordem ──')

/**
 * Se a ordem vencesse, o desenho do canvas mentiria: a pessoa liga dois nós
 * com uma seta e o motor ignoraria a seta.
 */
const comDesvio = [passo('a', 0, { padrao: 'c' }), passo('b', 1), passo('c', 2)]
ok('aresta explícita desvia', proximoPasso(comDesvio[0], comDesvio)?.id === 'c')

/**
 * Passo apagado deixa aresta pendurada. Cair no próximo por ordem faria a
 * pessoa receber a mensagem que o desenho mandou pular — erro que só aparece
 * no relato de um paciente.
 */
const arestaOrfa = [passo('a', 0, { padrao: 'apagado' }), passo('b', 1)]
ok('aresta para passo inexistente ENCERRA', proximoPasso(arestaOrfa[0], arestaOrfa) === null)

console.log('')
console.log('── Os ramos da condição ──')

const cond = passo('cond', 0, { sim: 'x', nao: 'y' }, 'condicao')
const comRamos = [cond, passo('x', 1), passo('y', 2), passo('z', 3)]
ok('ramo sim', proximoPasso(cond, comRamos, 'sim')?.id === 'x')
ok('ramo não', proximoPasso(cond, comRamos, 'nao')?.id === 'y')

/**
 * Condição com só o "sim" ligado: o "não" termina ali.
 *
 * Se o "não" caísse no próximo por ordem, os dois ramos acabariam no mesmo
 * lugar e a condição não teria servido para nada.
 */
const soSim = passo('cond', 0, { sim: 'x' }, 'condicao')
const parcial = [soSim, passo('x', 1), passo('y', 2)]
ok('ramo sem aresta ENCERRA, não cai na ordem', proximoPasso(soSim, parcial, 'nao') === null)

console.log('')
console.log('── A espera ──')

ok('dias viram minutos', minutosDeEspera({ dias: 2 }) === 2880)
ok('horas viram minutos', minutosDeEspera({ horas: 3 }) === 180)
ok('soma os três', minutosDeEspera({ dias: 1, horas: 2, minutos: 30 }) === 1590)

/**
 * Config inválida vale **zero**, e zero é seguro: o motor segue sem dormir.
 *
 * O contrário — tratar config ruim como espera longa — prenderia a pessoa no
 * funil para sempre, e ninguém notaria, porque o sintoma é ausência de
 * mensagem.
 */
for (const [rotulo, config] of [
    ['vazia', {}],
    ['negativa', { dias: -5 }],
    ['texto', { dias: 'dois' }],
    ['nula', null],
    ['NaN', { minutos: Number.NaN }],
    ['infinita', { minutos: Number.POSITIVE_INFINITY }],
] as const) {
    ok(`espera ${rotulo} vale zero`, minutosDeEspera(config) === 0)
}

ok('espera absurda é cortada no teto', minutosDeEspera({ dias: 9999 }) === ESPERA_MAX_MIN)

console.log('')
console.log('── A condição só pergunta sobre fatos ──')

ok('respondeu é válida', lerCondicao({ campo: 'respondeu' })?.campo === 'respondeu')
ok('etiqueta precisa de alvo', lerCondicao({ campo: 'tem_etiqueta' }) === null)
ok('com alvo passa', lerCondicao({ campo: 'tem_etiqueta', valor: 'tag_1' })?.valor === 'tag_1')
ok('campo inventado é recusado', lerCondicao({ campo: 'parece_interessado' }) === null)

console.log('')
console.log('── Os freios ──')

const tudoBem = {
    humanoAssumiu: false,
    optOutNoCanal: false,
    funilPublicado: true,
    contatoExiste: true,
}

ok('sem freio, segue', deveParar(tudoBem) === null)
ok('humano assumiu para', deveParar({ ...tudoBem, humanoAssumiu: true }) === 'humano_assumiu')
ok('opt-out para', deveParar({ ...tudoBem, optOutNoCanal: true }) === 'optout')
ok('despublicado para', deveParar({ ...tudoBem, funilPublicado: false }) === 'funil_despublicado')
ok('contato removido para', deveParar({ ...tudoBem, contatoExiste: false }) === 'contato_removido')

/**
 * A ordem dos freios importa para a mensagem que a tela mostra.
 *
 * Com contato removido E humano assumido, o motivo certo é o primeiro: não
 * existe conversa para alguém ter assumido.
 */
ok(
    'contato removido vence humano assumiu',
    deveParar({ ...tudoBem, contatoExiste: false, humanoAssumiu: true }) === 'contato_removido'
)

console.log('')
console.log('── O canal do passo ──')

ok('padrão é WhatsApp', canalDoPasso({}) === 'whatsapp')
ok('e-mail quando dito', canalDoPasso({ canal: 'email' }) === 'email')
ok('canal inventado cai no padrão', canalDoPasso({ canal: 'pombo' }) === 'whatsapp')

console.log('')
console.log('── O grafo, derivado da navegação ──')

/**
 * `sucessores` existe para NÃO reler `edges`. Se ele divergisse de
 * `proximoPasso`, a detecção de ciclo mediria um grafo que o motor não anda.
 */
const linear2 = [passo('a', 0), passo('b', 1)]
ok('passo comum tem um sucessor', sucessores(linear2[0], linear2).map((p) => p.id).join() === 'b')
ok('o último não tem nenhum', sucessores(linear2[1], linear2).length === 0)

const cond2 = passo('c', 0, { sim: 'x', nao: 'y' }, 'condicao')
const comDois = [cond2, passo('x', 1), passo('y', 2)]
ok('condição tem os dois ramos', sucessores(cond2, comDois).map((p) => p.id).sort().join() === 'x,y')

/** Dois ramos no mesmo destino são um sucessor, não dois. */
const mesmoDestino = passo('c', 0, { sim: 'x', nao: 'x' }, 'condicao')
ok(
    'ramos no mesmo destino não duplicam',
    sucessores(mesmoDestino, [mesmoDestino, passo('x', 1)]).length === 1
)

/** Passo comum NÃO consulta sim/nao — senão o grafo veria caminho que o motor não anda. */
const comumComRamos = passo('a', 0, { sim: 'z' }, 'mensagem')
const comZ = [comumComRamos, passo('b', 1), passo('z', 2)]
ok('passo comum ignora sim/nao', sucessores(comumComRamos, comZ).map((p) => p.id).join() === 'b')

console.log('')
console.log('── Ciclo no desenho ──')

/**
 * Um ciclo não dá erro: ele **funciona**, e manda a mesma sequência para
 * sempre. Quem nota primeiro é a pessoa que está recebendo.
 */
ok('desenho reto não tem ciclo', cicloNoDesenho(linear) === null)

const voltaPraTras = [passo('a', 0, { padrao: 'b' }), passo('b', 1, { padrao: 'a' })]
const c1 = cicloNoDesenho(voltaPraTras)
ok('a → b → a é ciclo', c1 !== null, c1 ? c1.join(' → ') : '')

const laçoEmSi = [passo('a', 0, { padrao: 'a' })]
ok('passo que aponta para si é ciclo', cicloNoDesenho(laçoEmSi) !== null)

/** Ciclo por dentro de uma condição conta igual. */
const cicloNoRamo = [
    passo('c', 0, { sim: 'x', nao: 'y' }, 'condicao'),
    passo('x', 1, { padrao: 'c' }),
    passo('y', 2),
]
ok('ciclo pelo ramo sim é ciclo', cicloNoDesenho(cicloNoRamo) !== null)

/**
 * O ciclo pode estar num trecho que o primeiro passo não alcança. Publicar isso
 * deixaria a bomba armada para quando alguém ligasse uma aresta até lá.
 */
const ilhaComCiclo = [
    passo('a', 0),
    passo('ilha1', 10, { padrao: 'ilha2' }),
    passo('ilha2', 11, { padrao: 'ilha1' }),
]
ok('ciclo em trecho inalcançável também é recusado', cicloNoDesenho(ilhaComCiclo) !== null)

/** Dois caminhos que se juntam NÃO são ciclo — é desenho comum. */
const junta = [
    passo('c', 0, { sim: 'x', nao: 'y' }, 'condicao'),
    passo('x', 1, { padrao: 'fim' }),
    passo('y', 2, { padrao: 'fim' }),
    passo('fim', 3),
]
ok('caminhos que se juntam não são ciclo', cicloNoDesenho(junta) === null)

/** O caminho devolvido tem de fechar: o primeiro id repete no fim. */
ok('o caminho devolvido fecha', c1 !== null && c1[0] === c1[c1.length - 1], c1?.join(' → '))

ok('o teto de transições é rede, não regra', MAX_TRANSICOES >= 2 * 100)

console.log('')
console.log('── Os gatilhos ──')

ok('etiqueta precisa de alvo', lerGatilho({ tipo: 'etiqueta_aplicada' }) === null)
ok(
    'com alvo passa',
    lerGatilho({ tipo: 'etiqueta_aplicada', alvo: 'tag_1' })?.alvo === 'tag_1'
)
ok('contato criado não precisa de alvo', lerGatilho({ tipo: 'contato_criado' })?.tipo === 'contato_criado')
ok('tipo inventado é recusado', lerGatilho({ tipo: 'quando_der_vontade' }) === null)

/** Json malformado é "ninguém entra", nunca "entra todo mundo". */
for (const [rotulo, valor] of [
    ['nulo', null],
    ['vazio', {}],
    ['texto', 'etiqueta_aplicada'],
    ['número', 7],
] as const) {
    ok(`trigger ${rotulo} não liga nada`, lerGatilho(valor) === null)
}

const gEtiqueta = { tipo: 'etiqueta_aplicada' as const, alvo: 'tag_1' }
const base = { workspaceId: 'w1', contactId: 'c1' }
ok('casa quando tipo e alvo batem', casa(gEtiqueta, { ...base, tipo: 'etiqueta_aplicada', alvo: 'tag_1' }))
ok('não casa com outra etiqueta', !casa(gEtiqueta, { ...base, tipo: 'etiqueta_aplicada', alvo: 'tag_2' }))
ok('não casa com outro tipo', !casa(gEtiqueta, { ...base, tipo: 'entrou_na_lista', alvo: 'tag_1' }))
ok('não casa sem alvo no evento', !casa(gEtiqueta, { ...base, tipo: 'etiqueta_aplicada' }))

/**
 * `contato_criado` ignora alvo dos dois lados — mas um alvo sobrando no evento
 * não pode fazer deixar de casar.
 */
ok(
    'contato criado casa com alvo sobrando',
    casa({ tipo: 'contato_criado' }, { ...base, tipo: 'contato_criado', alvo: 'sobra' })
)

ok('todo tipo declarado tem texto de tela', TIPOS_DE_GATILHO.length === 4)

console.log('')
console.log('── A publicação é o portão ──')

const gTag = { tipo: 'etiqueta_aplicada', alvo: 'tag_1' }
const bom = { trigger: gTag, maxAtivos: null, passos: linear }
ok('desenho bom publica', podePublicar(bom) === null)

ok('sem gatilho não publica', podePublicar({ ...bom, trigger: {} }) !== null)
ok('sem passo não publica', podePublicar({ ...bom, passos: [] }) !== null)

/**
 * Passo de tipo desconhecido: o motor pararia a passagem nele, então publicar
 * é prometer uma sequência que não anda.
 */
ok(
    'tipo desconhecido não publica',
    podePublicar({ ...bom, passos: [passo('a', 0, null, 'dancar')] }) !== null
)

const demais = Array.from({ length: MAX_PASSOS + 1 }, (_, i) => passo(`p${i}`, i))
ok('acima do teto de passos não publica', podePublicar({ ...bom, passos: demais }) !== null)
ok('no teto exato publica', podePublicar({ ...bom, passos: demais.slice(0, MAX_PASSOS) }) === null)

/**
 * Gatilho de lista exige teto. A primeira sincronização de uma lista por filtro
 * sobre uma base existente é indistinguível de disparo em massa: todo mundo é
 * "novo". Sem teto, "seja bem-vindo" sai para quem é paciente há dez anos.
 */
const gLista = { tipo: 'entrou_na_lista', alvo: 'lista_1' }
ok(
    'lista sem teto não publica',
    podePublicar({ trigger: gLista, maxAtivos: null, passos: linear }) !== null
)
ok(
    'lista com teto publica',
    podePublicar({ trigger: gLista, maxAtivos: 50, passos: linear }) === null
)
ok(
    'teto zero não conta como teto',
    podePublicar({ trigger: gLista, maxAtivos: 0, passos: linear }) !== null
)
/** Os outros gatilhos não exigem teto — só lista recebe gente em lote. */
ok('etiqueta sem teto publica', podePublicar({ ...bom, maxAtivos: null }) === null)

/** Ciclo é a recusa mais grave, e ela devolve o caminho para a tela destacar. */
const recusa = podePublicar({ ...bom, passos: voltaPraTras })
ok('ciclo não publica', recusa !== null)
ok('e a recusa traz o caminho do ciclo', Array.isArray(recusa?.ciclo), recusa?.ciclo?.join(' → '))

/** Toda recusa é frase para a tela, não código. */
for (const [rotulo, desenho] of [
    ['sem gatilho', { ...bom, trigger: {} }],
    ['sem passo', { ...bom, passos: [] }],
    ['com ciclo', { ...bom, passos: voltaPraTras }],
    ['lista sem teto', { trigger: gLista, maxAtivos: null, passos: linear }],
] as const) {
    const r = podePublicar(desenho)
    ok(`recusa "${rotulo}" é frase legível`, Boolean(r && r.motivo.length > 30 && /[a-z] [a-z]/.test(r.motivo)))
}

console.log('')
if (falhas > 0) {
    console.log(`${falhas} FALHA(S)`)
    process.exitCode = 1
} else {
    console.log('tudo passou')
}
