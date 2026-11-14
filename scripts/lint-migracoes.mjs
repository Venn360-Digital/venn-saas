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
 *
 * **Exceções registradas.** Existe uma lista em
 * `prisma/lint-migracoes.excecoes.json`, e ela existe por um motivo estreito:
 * migração ANTERIOR a este lint que já foi aplicada em algum banco não pode
 * receber o marcador, porque editar o arquivo muda o checksum e o
 * `prisma migrate deploy` passa a recusar o ambiente onde ela já rodou. Para
 * essas, a justificativa mora na lista, com o nome do diretório como chave.
 *
 * A lista NÃO é atalho para migração nova: nova usa o marcador no arquivo, que
 * aparece no diff do PR e o revisor cobra. E a exceção é impressa no log quando
 * usada — passar por ela é visível, não silencioso.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Exceções registradas, por nome do diretório da migração. Ver o cabeçalho. */
function excecoes() {
    try {
        const bruto = JSON.parse(readFileSync('packages/db/prisma/lint-migracoes.excecoes.json', 'utf8'))
        return Object.fromEntries(Object.entries(bruto).filter(([k]) => !k.startsWith('$')))
    } catch {
        return {}
    }
}

const base = process.argv[2] || process.env.LINT_MIGRACOES_BASE || ''

function novasMigracoes() {
    const alvo = 'packages/db/prisma/migrations/'
    // Dois pontos de propósito: diff de SNAPSHOT, que não exige merge-base —
    // o clone raso do Workers Builds tem a ref mas não garante ancestralidade
    // ("no merge base", medido em 13/11). Para o filtro de adicionados o
    // resultado é o mesmo: migração presente no HEAD e ausente na base.
    //
    // **Sem pathspec, e com `-M -l0`, de propósito** — e isto é a correção de
    // um defeito que reprovou o build de 14/11 na Fase 2 do monorepo.
    //
    // A detecção de rename do git precisa VER OS DOIS LADOS do par. Quando o
    // `git mv prisma/ packages/db/prisma/` moveu as migrações, um diff com
    // `-- packages/db/prisma/migrations/` passou a enxergar só o lado de
    // destino: a origem ficava fora do pathspec, não havia com que casar, e as
    // **71 migrações históricas voltaram a contar como novas**. O lint então
    // reavaliou o acervo inteiro e reprovou 6 migrações antigas, já aplicadas
    // em produção — que não podem receber o marcador, porque editá-las muda o
    // checksum e o `prisma migrate deploy` passa a recusar o ambiente onde
    // rodaram. Medido: com pathspec, 71 `A`; sem pathspec e com `-M`, 71 `R`.
    //
    // `-l0` remove o teto de pares que o git compara (o padrão desiste em
    // ~1000 e volta a reportar A+D) — um `git mv` de pasta grande estoura esse
    // teto, e foi para isso que o teto virou zero.
    //
    // O filtro por diretório passa a ser feito aqui, sobre o caminho de
    // destino, e não pelo git.
    const cmd = base
        ? `git diff --name-status -M -l0 ${base}..HEAD`
        : `git diff --name-status -M -l0 HEAD~1..HEAD`
    try {
        return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
            .split('\n')
            // `--name-status` dá "A\tcaminho" para adicionado e
            // "R100\tantigo\tnovo" para renomeado. Só o primeiro interessa:
            // migração movida ou renomeada não é migração nova.
            .map((linha) => linha.split('\t'))
            .filter(([estado]) => estado === 'A')
            .map(([, caminho]) => caminho)
            .filter((f) => f.startsWith(alvo) && f.endsWith('.sql'))
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

const REGISTRADAS = excecoes()
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
    const nomeDaMigracao = arquivo.split('/').at(-2)
    const razao = REGISTRADAS[nomeDaMigracao]
    // SET NOT NULL com DEFAULT na mesma migração é o caso comum e seguro.
    const soNotNullComDefault =
        achados.length === 1 && achados[0] === 'SET NOT NULL' && /\bDEFAULT\b/i.test(sql)

    if (achados.length > 0 && !temMarcador && !soNotNullComDefault) {
        if (razao) {
            // Visível de propósito: exceção que passa calada vira regra.
            console.warn(`⚠ ${arquivo}: ${achados.join(', ')} — exceção registrada: ${razao}`)
            continue
        }
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
