/**
 * As chaves do navegador de cada app, travadas à mão.
 *
 * A leitura dupla de `lib/armazenamento` só preserva a preferência de quem já
 * usa o produto se a chave ANTIGA estiver certa. E "certa" aqui não é uma
 * escolha: é um fato sobre o que está gravado no navegador de cada usuário
 * agora. Errar não lança nada — o som volta a ligado, os emojis recentes
 * voltam a zero, o contador de lembretes reaparece.
 *
 * Por isso os valores abaixo são ESCRITOS À MÃO, lidos do código que serve cada
 * produto hoje. Derivá-los do mesmo lugar que o código usa tornaria a prova
 * tautológica: ela passaria exatamente quando não devia.
 *
 * O que o código faz é `armazenamento.anterior(sufixo)` = `slug + sufixo`. O
 * que este teste afirma é que esse produto bate, app por app, com o nome real.
 *
 *     pnpm run test:armazenamento
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let passou = 0
let falhou = 0
function ok(nome: string, condicao: boolean, detalhe = '') {
    console.log(`  ${condicao ? 'ok ' : 'FALHOU'} ${nome}${detalhe ? `  — ${detalhe}` : ''}`)
    condicao ? passou++ : falhou++
}

/**
 * Os sufixos que o core passa para `anterior()`. Escritos aqui porque são a
 * OUTRA metade da derivação — se um deles mudar no core sem mudar aqui, a
 * comparação abaixo deixa de bater e o teste reprova, que é o que se quer.
 */
const SUFIXOS = {
    som: '360-sound-enabled',
    lembretes: '360-last-reminder-count',
    emojis: '.inbox.emoji.recent',
} as const

/**
 * As chaves que EXISTEM no navegador dos usuários de cada produto, lidas do
 * código de cada um antes da unificação. Um app novo entra aqui com os nomes
 * dele, ou o teste reprova dizendo o que falta.
 */
const CHAVES_JA_GRAVADAS: Record<string, Record<keyof typeof SUFIXOS, string>> = {
    odontobox360: {
        som: 'odontobox360-sound-enabled',
        lembretes: 'odontobox360-last-reminder-count',
        emojis: 'odontobox.inbox.emoji.recent',
    },
    stagent360: {
        som: 'stagent360-sound-enabled',
        lembretes: 'stagent360-last-reminder-count',
        emojis: 'stagent.inbox.emoji.recent',
    },
    conecta360: {
        som: 'conecta360-sound-enabled',
        lembretes: 'conecta360-last-reminder-count',
        emojis: 'conecta.inbox.emoji.recent',
    },
}

console.log('\nA chave antiga de cada app é slug + sufixo — e o slug vem da marca')
const apps = readdirSync('apps').filter((n) => existsSync(join('apps', n, 'src/config/brand.ts')))
ok('há app com brand.ts', apps.length > 0, apps.join(', '))

for (const app of apps) {
    const fonte = readFileSync(join('apps', app, 'src/config/brand.ts'), 'utf8')
    const slug = fonte.match(/^\s+slug: '([^']+)'/m)?.[1]
    ok(`${app} declara um slug`, Boolean(slug), slug ?? '(não achei)')
    const esperadas = CHAVES_JA_GRAVADAS[app]
    if (!esperadas) {
        ok(
            `${app} está em CHAVES_JA_GRAVADAS`,
            false,
            'app novo: acrescente as três chaves que o navegador dos usuários dele já tem'
        )
        continue
    }
    for (const [qual, sufixo] of Object.entries(SUFIXOS) as Array<[keyof typeof SUFIXOS, string]>) {
        const derivada = `${slug}${sufixo}`
        ok(
            `${app}/${qual}: a derivação dá a chave real`,
            derivada === esperadas[qual],
            derivada === esperadas[qual] ? derivada : `derivou "${derivada}", o navegador tem "${esperadas[qual]}"`
        )
    }
}

/*
 * E a direção que importa para o futuro: duas marcas diferentes NÃO podem
 * derivar a mesma chave. `localStorage` é por origem, não por aplicação — duas
 * chaves iguais fariam o som de um produto controlar o do outro.
 */
console.log('\nDuas marcas nunca derivam a mesma chave')
const todas = apps.flatMap((app) => {
    const fonte = readFileSync(join('apps', app, 'src/config/brand.ts'), 'utf8')
    const slug = fonte.match(/^\s+slug: '([^']+)'/m)?.[1] ?? ''
    return Object.values(SUFIXOS).map((s) => `${slug}${s}`)
})
ok('todas as chaves derivadas são distintas', new Set(todas).size === todas.length, `${todas.length} chave(s)`)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
