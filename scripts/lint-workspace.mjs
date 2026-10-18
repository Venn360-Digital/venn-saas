#!/usr/bin/env node
/**
 * Impede que volte a existir rota que escolhe o workspace sozinha.
 *
 * Toda rota resolvia a participação assim:
 *
 *     prisma.workspaceUser.findFirst({ where: { userId: user.id, isActive: true },
 *                                      orderBy: { createdAt: 'asc' } })
 *
 * "a mais antiga" — inofensivo enquanto cada pessoa tem um workspace só. No
 * instante em que o Multiclínica permitir três, **uma rota que não migrou passa
 * a ler a unidade errada**, ignorando a escolhida, em silêncio. E às vezes
 * acerta por sorte, que é o pior tipo de defeito: some do teste e aparece no
 * cliente.
 *
 * O jeito de não esquecer nenhuma não é cuidado — é o build reclamar. Compara
 * com uma linha de base que pode cair e nunca subir, como o `lint-colors`:
 * código novo não consegue acrescentar o padrão, e o número desce conforme as
 * rotas migram para `getWorkspaceMember()`.
 *
 *   node scripts/lint-workspace.mjs            confere
 *   node scripts/lint-workspace.mjs --update   registra a contagem atual
 *   node scripts/lint-workspace.mjs --list     mostra onde ainda está
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BASELINE_FILE = join(ROOT, 'scripts', 'workspace-baseline.json')

/**
 * Quem pode resolver participação por conta própria.
 *
 * Um só: o helper. É ele que vai aprender a ler o workspace escolhido, e é por
 * isso que ele precisa ser o único caminho — uma segunda porta significa uma
 * segunda chance de ler a unidade errada.
 */
const ALLOWED = ['src/lib/auth/workspace.ts']

const CHAMADA = 'prisma.workspaceUser.findFirst'

/**
 * Nem todo `findFirst` em participação é o defeito.
 *
 * Procurar **um membro de um workspace dado** é legítimo e acontece fora de
 * qualquer sessão: o executor de regras atribuindo a conversa a alguém daquele
 * departamento, o e-mail de cobrança achando o dono daquela unidade, a
 * checagem de dono da plataforma. Todos dizem de qual workspace falam.
 *
 * O perigoso é o oposto: `userId` + `isActive` e **nenhuma pista de qual
 * unidade** — aí a consulta escolhe sozinha, "a mais antiga", e ignora o que a
 * pessoa selecionou. Um verificador que reclamasse dos três casos legítimos
 * seria desligado na primeira semana, e aí não protegeria nada.
 */
function perigoso(trecho) {
    const where = trecho.match(/where:\s*\{([\s\S]*?)\}/)
    if (!where) return true
    const corpo = where[1]
    const escolheSozinho =
        /\buserId\b/.test(corpo) &&
        /\bisActive\b/.test(corpo) &&
        !/\bworkspaceId\b/.test(corpo) &&
        !/\bworkspace\s*:/.test(corpo)
    return escolheSozinho
}

/** Do `(` que abre a chamada até o `)` que o fecha, contando parênteses. */
function chamadaCompleta(texto, i) {
    const ini = texto.indexOf('(', i)
    let nivel = 0
    for (let j = ini; j < texto.length; j++) {
        if (texto[j] === '(') nivel++
        else if (texto[j] === ')' && --nivel === 0) return texto.slice(ini, j + 1)
    }
    return texto.slice(ini)
}

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (/\.tsx?$/.test(full)) out.push(full)
    }
    return out
}

const findings = []
for (const file of walk(SRC)) {
    const rel = relative(ROOT, file)
    if (ALLOWED.some((p) => rel.startsWith(p))) continue
    const texto = readFileSync(file, 'utf8')
    let count = 0
    let i = texto.indexOf(CHAMADA)
    while (i !== -1) {
        if (perigoso(chamadaCompleta(texto, i))) count++
        i = texto.indexOf(CHAMADA, i + CHAMADA.length)
    }
    if (count) findings.push({ file: rel, count })
}

const total = findings.reduce((n, f) => n + f.count, 0)

if (process.argv.includes('--list')) {
    for (const f of [...findings].sort((a, b) => b.count - a.count)) {
        console.log(`${String(f.count).padStart(4)}  ${f.file}`)
    }
    console.log(`\n${total} no total, em ${findings.length} arquivos`)
    process.exit(0)
}

if (process.argv.includes('--update')) {
    writeFileSync(BASELINE_FILE, JSON.stringify({ total }, null, 2) + '\n')
    console.log(`Linha de base registrada: ${total}`)
    process.exit(0)
}

const baseline = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).total
    : 0

if (total > baseline) {
    console.error(
        `\nRota resolvendo workspace por conta própria: ${total} agora, ${baseline} na linha de base.\n` +
            `Use getWorkspaceMember() de @/lib/auth/workspace — é ele que sabe qual unidade está escolhida.\n` +
            `Para ver onde: npm run lint:workspace -- --list\n`
    )
    process.exit(1)
}

if (total < baseline) {
    console.log(
        `${total} rotas ainda resolvem o workspace sozinhas (linha de base ${baseline}).\n` +
            `Caiu — rode: npm run lint:workspace -- --update`
    )
    process.exit(0)
}

console.log(
    total === 0
        ? 'Nenhuma rota resolve o workspace por conta própria.'
        : `${total} rotas ainda resolvem o workspace sozinhas (linha de base ${baseline}).`
)
