/**
 * A tabela de decisão da sonda de credencial de IA.
 *
 *   npm run test:sonda
 *
 * O caso que importa é o **403 ambíguo**: a OpenAI devolve 403 tanto para
 * credencial sem permissão quanto para modelo fora da allowlist do projeto, e
 * confundir os dois manda a pessoa trocar a chave quando o problema é a
 * allowlist — ou o contrário. O corpo da resposta é o único desempate, e é
 * esta a função que o lê.
 *
 * E o avesso: 429 e 5xx **não** podem virar e-mail. A sonda roda uma vez por
 * dia; um 503 momentâneo da OpenAI que acorde o suporte é como se ensina
 * alguém a criar filtro para o remetente.
 */
import { assuntoDoAviso, julgar, mereceAviso } from '@/lib/llm/sonda'

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

const estado = (s: number, corpo = '') => julgar(s, corpo).estado
const avisa = (s: number, corpo = '') => mereceAviso(julgar(s, corpo))

console.log('\n— a classificação —\n')

conferir('200 é ok', estado(200), 'ok')
conferir('401 é credencial', estado(401, 'Incorrect API key provided'), 'credencial')
conferir('403 sem pista de modelo é credencial', estado(403, 'insufficient permissions'), 'credencial')
conferir('403 falando de modelo é allowlist', estado(403, 'The model `x` does not exist'), 'modelo')
conferir('404 é allowlist', estado(404, 'model_not_found'), 'modelo')
conferir('429 é indisponibilidade', estado(429, 'rate limit'), 'indisponivel')
conferir('500 é indisponibilidade', estado(500, 'server error'), 'indisponivel')
conferir('503 é indisponibilidade', estado(503, ''), 'indisponivel')

console.log('\n— quem acorda o suporte, e quem não —\n')

conferir('401 avisa', avisa(401, 'Incorrect API key'), true)
conferir('403 de credencial avisa', avisa(403, 'no permission'), true)
conferir('404 de modelo avisa', avisa(404, 'model_not_found'), true)
conferir('429 NÃO avisa', avisa(429, 'rate limit'), false)
conferir('500 NÃO avisa', avisa(500, 'oops'), false)
conferir('falha de rede (status 0) NÃO avisa', avisa(0, 'fetch failed'), false)
conferir('200 NÃO avisa', avisa(200), false)
conferir('sem chave avisa', mereceAviso({ estado: 'sem-chave' }), true)

console.log('\n— o assunto diz qual dos dois consertos é —\n')

const assunto = (s: number, corpo: string) => {
    const v = julgar(s, corpo)
    return mereceAviso(v) ? assuntoDoAviso(v, 'odontobox/production') : '(sem aviso)'
}
conferir(
    '401 fala de chave recusada',
    assunto(401, 'Incorrect API key'),
    '[odontobox/production] A chave da OpenAI foi recusada (401)'
)
conferir(
    '404 fala de modelo não liberado',
    assunto(404, 'model_not_found'),
    '[odontobox/production] O modelo da transcrição não está liberado (404)'
)
conferir(
    'sem chave tem assunto próprio',
    assuntoDoAviso({ estado: 'sem-chave' }, 'stagent/production'),
    '[stagent/production] A IA está sem chave configurada'
)

console.log(`\n${passou} ok, ${falhou} falhas\n`)
if (falhou > 0) process.exit(1)
