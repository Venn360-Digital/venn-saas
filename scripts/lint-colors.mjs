#!/usr/bin/env node
/**
 * Fails when hardcoded colour creeps back into the app layer.
 *
 * The palette migration moves ~900 call sites across twelve screens, and those
 * screens are migrated one at a time. A check that demanded zero would be red
 * for the whole of that work and would simply be ignored — so it compares
 * against a recorded baseline instead: the count may fall, never rise. When it
 * reaches zero the baseline is zero and the check becomes absolute.
 *
 *   node scripts/lint-colors.mjs            check against the baseline
 *   node scripts/lint-colors.mjs --update   record the current count
 *   node scripts/lint-colors.mjs --list     print every offending line
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BASELINE_FILE = join(ROOT, 'scripts', 'color-baseline.json')

/**
 * Paths that may hold literal colour, with the reason.
 * Everything else must go through a token.
 */
const ALLOWED = [
    // Vendored shadcn primitives. They carry upstream's own classes, and a
    // `shadcn add` would overwrite any edit we made here anyway.
    'src/components/ui/',
    // The single component that renders a user-chosen hex from the database.
    'src/components/shared/TagChip.tsx',
    // Renders above ThemeProvider, where CSS variables are not guaranteed.
    'src/app/global-error.tsx',
    // Other companies' brand colours, declared in one place on purpose.
    'src/lib/brand-colors.ts',
]

const PALETTE =
    /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|accent|decoration|shadow|placeholder|caret)-(?:purple|violet|indigo|fuchsia|pink|rose|gray|slate|zinc|neutral|stone)-\d{2,3}\b/g
const ARBITRARY_HEX = /\[#[0-9a-fA-F]{3,8}\]/g

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (/\.tsx?$/.test(full)) out.push(full)
    }
    return out
}

function isAllowed(relPath) {
    return ALLOWED.some((prefix) => relPath.startsWith(prefix))
}

const findings = []

for (const file of walk(SRC)) {
    const rel = relative(ROOT, file)
    if (isAllowed(rel)) continue

    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
        for (const pattern of [PALETTE, ARBITRARY_HEX]) {
            pattern.lastIndex = 0
            const matches = line.match(pattern)
            if (matches) {
                findings.push({ file: rel, line: i + 1, matches, text: line.trim() })
            }
        }
    })
}

const total = findings.reduce((n, f) => n + f.matches.length, 0)

if (process.argv.includes('--list')) {
    const byFile = new Map()
    for (const f of findings) {
        byFile.set(f.file, (byFile.get(f.file) ?? 0) + f.matches.length)
    }
    for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) {
        console.log(`${String(count).padStart(4)}  ${file}`)
    }
    console.log(`\n${total} no total, em ${byFile.size} arquivos`)
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
        `\nCor hardcoded aumentou: ${total} agora, ${baseline} na linha de base.\n` +
            `Use um token em vez de uma cor literal. Veja DESIGN.md.\n` +
            `Para ver onde: npm run lint:colors -- --list\n`
    )
    process.exit(1)
}

if (total < baseline) {
    console.log(
        `${total} usos de cor hardcoded (linha de base ${baseline}).\n` +
            `Caiu — rode: npm run lint:colors -- --update`
    )
    process.exit(0)
}

console.log(
    total === 0
        ? 'Nenhuma cor hardcoded fora dos caminhos permitidos.'
        : `${total} usos de cor hardcoded, igual à linha de base.`
)
