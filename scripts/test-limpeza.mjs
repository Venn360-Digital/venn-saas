/**
 * A limpeza de tipos gerados apaga mesmo — prova no sentido de falhar.
 *
 *     npm run test:limpeza
 *
 * ## Por que isto existe
 *
 * `limpar-tipos-gerados.mjs` ficou quebrado por dias sem ninguém notar: ele
 * apagava caminhos relativos ao diretório de trabalho (`.next/types`), mas num
 * monorepo o `.next` mora em `apps/<app>/.next`. Com `force: true` o ENOENT era
 * engolido e ele imprimia "tipos gerados limpos" sem ter tocado em nada.
 *
 * O portão `verificar` começa por ele, então o portão **parecia** limpar. Em
 * 26/11/2026 um `validator.ts` de outro branch sobreviveu e fez `tsc` reprovar
 * com 24 erros `TS2307` apontando para rotas que não existiam ali — nenhuma
 * delas em arquivo alterado.
 *
 * A lição não é sobre caminho: é que **script de limpeza que afirma sucesso sem
 * evidência não é observável**. O conserto fez a mensagem dizer o que apagou, e
 * este teste prende o comportamento para que a próxima mudança de caminho
 * reprove aqui em vez de estragar um portão em silêncio.
 *
 * ## O que ele faz
 *
 * Planta um arquivo em cada caminho gerado de cada app, roda a limpeza, e exige
 * que **todos** tenham sumido e que a mensagem os tenha nomeado. Planta em
 * `.next/`, que é ignorado pelo git e é descartável por definição: o que o Next
 * precisar, ele gera de novo.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIMPEZA = join(RAIZ, 'scripts', 'limpar-tipos-gerados.mjs')
const GERADOS = ['.next/types', '.next/dev/types']

let passou = 0
let falhou = 0

function conferir(nome, real, esperado) {
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

/** Os apps de verdade, pela pasta — a mesma fonte que a limpeza usa. */
const apps = readdirSync(join(RAIZ, 'apps'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(RAIZ, 'apps', e.name))

console.log(`\nA limpeza de tipos gerados — ${apps.length} app(s) na pasta`)

conferir('há pelo menos um app para varrer', apps.length > 0, true)

// ── Planta o lixo nos dois caminhos de cada app ──────────────────────────────
const plantados = []
for (const app of apps) {
    for (const gerado of GERADOS) {
        const pasta = join(app, gerado)
        mkdirSync(pasta, { recursive: true })
        const arquivo = join(pasta, 'validator.ts')
        // O conteúdo imita o defeito real: import de um módulo que não existe,
        // que é o que fazia `tsc` reprovar.
        writeFileSync(arquivo, "import type { Nada } from './routes.js'\nexport const x: Nada = 1\n")
        plantados.push(arquivo)
    }
}

conferir('o lixo foi plantado nos dois caminhos de cada app', plantados.length, apps.length * 2)
conferir('e existe antes da limpeza', plantados.every((p) => existsSync(p)), true)

// ── Roda a limpeza ──────────────────────────────────────────────────────────
const saida = execFileSync('node', [LIMPEZA], { encoding: 'utf8' }).trim()
console.log(`      saída: ${saida}`)

/**
 * **A asserção central.** Se alguém devolver a limpeza a caminhos relativos ao
 * diretório de trabalho, ou esquecer um dos dois caminhos gerados, isto reprova.
 */
conferir(
    'todo arquivo plantado sumiu',
    plantados.filter((p) => existsSync(p)),
    []
)

/**
 * A segunda asserção é sobre a **mensagem**, e não é zelo: foi a mensagem
 * otimista que escondeu o defeito. Dizer o que apagou é parte do contrato.
 */
conferir('a mensagem nomeia o que foi apagado, não o que tentou', saida.includes('apps/'), true)
conferir('e não diz "nada a apagar" quando havia o que apagar', saida.includes('nada a apagar'), false)

// ── Rodar de novo, com tudo limpo, tem de dizer que não havia nada ───────────
const segunda = execFileSync('node', [LIMPEZA], { encoding: 'utf8' }).trim()
conferir('com tudo limpo, a mensagem é "nada a apagar"', segunda, 'tipos gerados: nada a apagar')

// ── E o diretório de trabalho não pode mudar o resultado ─────────────────────
for (const app of apps) {
    mkdirSync(join(app, GERADOS[0]), { recursive: true })
    writeFileSync(join(app, GERADOS[0], 'validator.ts'), 'export const x = 1\n')
}
const deFora = execFileSync('node', [LIMPEZA], { encoding: 'utf8', cwd: '/' }).trim()
conferir(
    'rodando de outro diretório, apaga igual',
    apps.filter((app) => existsSync(join(app, GERADOS[0], 'validator.ts'))),
    []
)
conferir('e a mensagem de fora também nomeia os caminhos', deFora.includes('apps/'), true)

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
