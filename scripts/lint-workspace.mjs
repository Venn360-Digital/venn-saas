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

const PADRAO = /prisma\.workspaceUser\.findFirst/g

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
    PADRAO.lastIndex = 0
    const matches = texto.match(PADRAO)
    if (matches) findings.push({ file: rel, count: matches.length })
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
