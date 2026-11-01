#!/usr/bin/env node
/**
 * Lint de migração — a regra expand/contract vira portão, não prosa.
 *
 *   node scripts/lint-migracoes.mjs [base-ref]
 *
 * O portão de produção roda a migração no deploy command: se o publish falhar
 * depois dela, produção roda **código velho contra schema novo** até o retry.
 * Isso só é seguro quando toda migração é compatível com a versão anterior do
 * código (expand) — e a fase destrutiva (contract) só entra quando nenhum
 * código vivo depende do que ela remove. A regra estava escrita em prosa no
 * runbook (Fase 12 §3) e **nada a verificava**; o precedente da casa é que,
 * quando foi violada, o sintoma ficou invisível (erro de busca engolido —
 * "coluna nova precisa de queda para trás").
 *
 * O que este lint faz: olha só as migrações NOVAS do diff (base...HEAD) e
 * reprova DDL destrutivo — a menos que o arquivo declare, por escrito,
 * `-- contract` numa linha própria. O marcador não é burocracia: é o autor
 * afirmando "nenhum código publicado depende mais disto", e fica no diff do PR
 * para o revisor cobrar.
 *
 * Padrões reprovados sem marcador:
 *   DROP TABLE · DROP COLUMN · ALTER COLUMN ... TYPE · RENAME TO/COLUMN ·
 *   SET NOT NULL (quebra INSERT antigo que não envia a coluna, salvo DEFAULT)
 *
 * Grep de 60 linhas, zero dependência. Falso positivo se resolve com o
 * marcador; falso negativo é aceito — isto é um tropeço consciente, não prova
 * formal de compatibilidade.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const base = process.argv[2] || process.env.LINT_MIGRACOES_BASE || ''

function novasMigracoes() {
    const alvo = 'prisma/migrations/'
    const cmd = base
        ? `git diff --name-only --diff-filter=A ${base}...HEAD -- ${alvo}`
        : `git diff --name-only --diff-filter=A HEAD~1...HEAD -- ${alvo}`
    try {
        return execSync(cmd, { encoding: 'utf8' })
            .split('\n')
            .filter((f) => f.endsWith('.sql'))
    } catch {
        console.error(`não consegui diffar contra "${base || 'HEAD~1'}" — nada a verificar aqui não é verde: saindo com erro`)
        process.exit(2)
    }
}

const DESTRUTIVOS = [
    [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
    [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
    [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, 'ALTER COLUMN ... TYPE'],
    [/\bRENAME\s+(TO|COLUMN)\b/i, 'RENAME'],
    [/\bSET\s+NOT\s+NULL\b/i, 'SET NOT NULL'],
]

const arquivos = novasMigracoes()
if (arquivos.length === 0) {
    console.log('lint de migração: nenhuma migração nova no diff')
    process.exit(0)
}

let falhas = 0
for (const arquivo of arquivos) {
    let sql
    try {
        sql = readFileSync(arquivo, 'utf8')
    } catch {
        continue // adicionada e removida dentro do mesmo PR
    }
    const temMarcador = /^\s*--\s*contract\b/im.test(sql)
    const achados = DESTRUTIVOS.filter(([re]) => re.test(sql)).map(([, nome]) => nome)
    // SET NOT NULL com DEFAULT na mesma migração é o caso comum e seguro.
    const soNotNullComDefault =
        achados.length === 1 && achados[0] === 'SET NOT NULL' && /\bDEFAULT\b/i.test(sql)

    if (achados.length > 0 && !temMarcador && !soNotNullComDefault) {
        falhas++
        console.error(`✖ ${arquivo}: ${achados.join(', ')} sem o marcador "-- contract"`)
    }
}

if (falhas > 0) {
    console.error(
        `\n${falhas} migração(ões) destrutiva(s) sem marcador.\n` +
        'A migração roda ANTES de o código novo estar no ar (portão no deploy): ela tem\n' +
        'de ser compatível com o código atual (expand). Se isto é a fase contract —\n' +
        'nenhum código publicado depende mais do que ela remove — declare numa linha:\n' +
        '    -- contract: <por que é seguro agora>\n'
    )
    process.exit(1)
}
console.log(`lint de migração: ${arquivos.length} nova(s), todas compatíveis ou marcadas`)
