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
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { arquivosDeCodigo, exigirPiso, conferirAllowlist } from './lib/raizes-de-codigo.mjs'

const ROOT = process.cwd()
const BASELINE_FILE = join(ROOT, 'scripts', 'color-baseline.json')

/**
 * Paths that may hold literal colour, with the reason.
 * Everything else must go through a token.
 */
const ALLOWED = [
    // Vendored shadcn primitives. They carry upstream's own classes, and a
    // `shadcn add` would overwrite any edit we made here anyway. Mudaram para
    // `packages/ui` na Fase 2; `conferirAllowlist` é que cobrou esta linha.
    'packages/ui/src/',
    // The single component that renders a user-chosen hex from the database.
    'packages/core/src/components/shared/TagChip.tsx',
    // Renders above ThemeProvider, where CSS variables are not guaranteed.
    'src/app/global-error.tsx',
    // Other companies' brand colours, declared in one place on purpose.
    'packages/core/src/lib/brand-colors.ts',
    // Our own palette as literal hex, for the three places a token cannot
    // reach: a value stored in the database, a colour picker's options, and
    // e-mail. See the file's own header.
    'packages/core/src/lib/palette.ts',
    // A identidade da marca por app (Fase 03): o ÚNICO lugar com o hex da marca,
    // que é a fonte dos tokens. Clonar o produto é trocar este arquivo — por
    // isso o hex literal aqui é por decisão, como em `palette.ts`.
    'src/config/brand.ts',
    // E-mail HTML. CSS variables do not exist in a mail client, so the brand
    // has to be inlined; the values come from the same palette.
    'packages/core/src/lib/email/',
    // O widget do site, que é renderizado dentro de um Shadow DOM na página de
    // outra empresa: ali as nossas variáveis de CSS não existem, e usar um
    // token seria pedir uma cor que ninguém definiu. Passava sem estar aqui
    // só porque os hex estão soltos dentro de um template, e não entre aspas —
    // isenção por acidente do padrão. Agora é por decisão.
    'src/app/widget.js/',
]

const PREFIX =
    '(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|accent|decoration|shadow|placeholder|caret)'

// Every step of the raw Tailwind scale, state hues included.
//
// The first version listed only the hues the rebrand was removing — purple,
// gray, cyan — and left red, amber, green and blue alone, because those "mean
// something". They do, which is exactly why they belong to `destructive`,
// `warning`, `success` and `info`: as raw steps they were 155 uses picking
// their own -400 (a dark-mode value) on white surfaces, and green meant
// "active" on one screen and "paid" on another.
const PALETTE = new RegExp(
    `\\b${PREFIX}-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|slate|zinc|neutral|stone)-\\d{2,3}\\b`,
    'g'
)

// Literal white and black take no numeric step, so the palette pattern missed
// them — and they were the single largest remaining group: 48 uses of text-white
// standing in for what is really `foreground`, invisible the moment the surface
// under them turned white.
// `bg-black/<n>` is excluded: a modal scrim darkens whatever sits behind it, so
// it is correct in both themes and is what the Dialog primitive itself uses. Any
// other literal white or black is a token that was not reached for.
const MONOCHROME = new RegExp(
    `\\b${PREFIX}-white(?:\\/\\d{1,3})?\\b|\\b(?:text|border|ring|fill|stroke|divide|placeholder|caret)-black(?:\\/\\d{1,3})?\\b|\\bbg-black\\b(?!\\/)`,
    'g'
)
// `[#rrggbb]` in a class, and a quoted hex in code. The quoted form was the
// blind spot that kept the Kaly indigo→fuchsia ramp alive inside STAGE_COLORS
// and seeded it into every new workspace's funnel. A hex that must be literal —
// stored in the database, offered in a picker, rendered in e-mail — lives in
// `src/lib/palette.ts`, which is allowlisted.
const ARBITRARY_HEX = /\[#[0-9a-fA-F]{3,8}\]/g
const QUOTED_HEX = /['"`]#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?['"`]/g

function isAllowed(relPath) {
    return ALLOWED.some((prefix) => relPath.startsWith(prefix))
}

/**
 * As raízes vêm derivadas, e a varredura é medida.
 *
 * Antes era `walk(join(ROOT,'src'))` fixo. No monorepo o código se espalha por
 * `packages/<pacote>/src` e `apps/<app>/src`, e uma raiz fixa não erra alto:
 * ela aprova uma árvore vazia. O piso de 400 é folgado de propósito — pega
 * colapso, não a variação normal de um projeto que cresce (hoje: 682).
 */
const arquivos = arquivosDeCodigo()
exigirPiso('lint-colors', arquivos, 400)
conferirAllowlist('lint-colors', ALLOWED, arquivos)

const findings = []

for (const rel of arquivos) {
    if (isAllowed(rel)) continue

    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n')
    lines.forEach((line, i) => {
        for (const pattern of [PALETTE, MONOCHROME, ARBITRARY_HEX, QUOTED_HEX]) {
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
