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
    deveParar,
    ESPERA_MAX_MIN,
    lerCondicao,
    minutosDeEspera,
    primeiroPasso,
    proximoPasso,
    type PassoDoFunil,
} from '../src/lib/funil/passos'

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
if (falhas > 0) {
    console.log(`${falhas} FALHA(S)`)
    process.exitCode = 1
} else {
    console.log('tudo passou')
}
