/**
 * A semeadura do cofre da conta.
 *
 *   npm run test:cofre-conta
 *
 * Duas invariantes, e as duas são promessas feitas na migração:
 *
 * 1. **o ambiente vence** — declarar o binding não tira do ar o segredo que já
 *    estava no Worker, então a adoção é reversível e os dois caminhos convivem;
 * 2. **nada de valor em log** — `resumirSemeadura` só diz nomes e origens.
 *
 * A função semeia uma vez por processo (guarda de isolate), então o teste faz
 * **uma** chamada com os três casos misturados dentro dela.
 */
import {
    SEGREDOS_DA_CONTA,
    resumirSemeadura,
    semearCofreDaConta,
} from '@/lib/secrets/cofre-da-conta'

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

// Ambiente preparado: um segredo já posto (como um `wrangler secret put`),
// e o resto limpo.
for (const n of SEGREDOS_DA_CONTA) delete process.env[n]
process.env.PLATFORM_ASAAS_CLIENT_ID = 'valor-do-worker'

const doCofre = (valor: string) => ({ get: async () => valor })

const resultado = await semearCofreDaConta({
    // já existe no ambiente: o cofre NÃO pode vencer
    PLATFORM_ASAAS_CLIENT_ID: doCofre('valor-do-cofre'),
    // só no cofre: entra
    OPENAI_API_KEY: doCofre('sk-do-cofre'),
    PLATFORM_ASAAS_CLIENT_SECRET: doCofre('segredo-do-cofre'),
    // cofre que devolve vazio conta como ausente, não como configurado
    PLATFORM_GOOGLE_CALENDAR_CLIENT_ID: doCofre('   '),
    // sem binding e sem ambiente: ausente
})

console.log('\n— as três origens —\n')

conferir('o que veio do cofre', resultado.doCofre.sort(), [
    'OPENAI_API_KEY',
    'PLATFORM_ASAAS_CLIENT_SECRET',
])
conferir('o que já vinha do ambiente', resultado.doAmbiente, ['PLATFORM_ASAAS_CLIENT_ID'])
conferir('o que falta de verdade', resultado.ausentes.sort(), [
    'PLATFORM_GOOGLE_CALENDAR_CLIENT_ID',
    'PLATFORM_GOOGLE_CALENDAR_CLIENT_SECRET',
])

console.log('\n— a invariante que torna a adoção reversível —\n')

conferir(
    'o cofre NÃO sobrescreve o segredo do Worker',
    process.env.PLATFORM_ASAAS_CLIENT_ID,
    'valor-do-worker'
)
conferir('o que só o cofre tinha chegou ao ambiente', process.env.OPENAI_API_KEY, 'sk-do-cofre')
conferir(
    'cofre vazio não define a variável',
    process.env.PLATFORM_GOOGLE_CALENDAR_CLIENT_ID ?? null,
    null
)

console.log('\n— o resumo não pode carregar valor —\n')

const resumo = resumirSemeadura(resultado)
console.log(`      resumo: ${resumo}`)
for (const vazado of ['sk-do-cofre', 'valor-do-worker', 'segredo-do-cofre', 'valor-do-cofre']) {
    conferir(`não vaza "${vazado}"`, resumo.includes(vazado), false)
}

console.log('\n— a segunda chamada é inerte (guarda de isolate) —\n')

const segunda = await semearCofreDaConta({ OPENAI_API_KEY: doCofre('outra-coisa') })
conferir('segunda chamada não faz nada', segunda, {
    doCofre: [],
    doAmbiente: [],
    ausentes: [],
})
conferir('e não troca o valor já semeado', process.env.OPENAI_API_KEY, 'sk-do-cofre')

console.log(`\n${passou} ok, ${falhou} falhas\n`)
if (falhou > 0) process.exit(1)
