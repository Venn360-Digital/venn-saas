#!/usr/bin/env node
/**
 * Alinha os checksums de `_prisma_migrations` com os arquivos DESTE repositório.
 *
 * ── O problema que isto resolve ─────────────────────────────────────────────
 *
 * O `_prisma_migrations` guarda o sha256 do ARQUIVO aplicado, e o
 * `prisma migrate deploy` RECUSA o banco quando o arquivo do repositório tem
 * checksum diferente do registrado — ele assume que a migração foi editada
 * depois de rodar, que é o acidente clássico.
 *
 * Os clones vieram de repositórios próprios. Medido em 17/11/2026:
 *
 *   odontobox (stg)   71 aplicadas, 71 com checksum igual ao do monorepo
 *   conecta (stg)     70 aplicadas, 61 iguais, 9 DIFERENTES
 *   stagent (stg)     70 aplicadas, 61 iguais, 9 DIFERENTES — a mesma lista
 *
 * Enquanto isso valer, repontar o Worker de um clone para este repositório
 * reprova no portão, antes de qualquer deploy. É o portão das Fases 5–7.
 *
 * ── Por que alinhar o checksum é VERDADE, e não um remendo ──────────────────
 *
 * Os nove arquivos foram buscados dos repositórios dos clones e comparados
 * linha a linha, ignorando comentário e linha vazia:
 *
 *   8 dos 9                      ZERO linha de SQL diferente — divergem só na
 *                                prosa dos comentários
 *   degenericizar_agenda         11 linhas, e são EXATAMENTE as que criam as
 *                                três views de compatibilidade (`CREATE VIEW` ×3
 *                                mais os `ALTER VIEW ... SET DEFAULT`)
 *
 * E essas três views foram removidas em 17/11
 * (`20261117010000_remover_views_de_compatibilidade`). Com elas fora, o efeito
 * das duas versões do arquivo converge: **o arquivo deste repositório produz
 * exatamente o estado em que o banco está.** Reescrever o checksum afirma isso,
 * e é factual.
 *
 * A prova independente, do outro lado: comparando o catálogo dos três bancos,
 * tabelas e colunas (com DEFAULT) são idênticas e os 232 índices são idênticos;
 * conecta e stagent são byte-idênticos nos três eixos.
 *
 * ── Por que não o squash do baseline ───────────────────────────────────────
 *
 * O plano previa resolver isto com o squash: 72 migrações viram uma, e
 * `migrate resolve --applied` nos seis bancos. Funciona, mas é maior e tem uma
 * ordem RÍGIDA — se o squash for mesclado antes do resolve, todo deploy passa a
 * reprovar (o baseline aparece como pendente e tenta `CREATE TABLE` em tabela
 * que existe). Alinhar nove checksums não tem ordem, não toca o repositório e
 * é reversível linha a linha.
 *
 * O squash continua valendo por mérito próprio — 72 migrações viram uma, e some
 * a mina de `20261006000000_enable_rls`, que habilita RLS em 27 tabelas e, num
 * banco novo com papel de aplicação não-dono, nasceria lendo vazio. Mas isso é
 * Fase 8, desacoplado do cutover.
 *
 * ── Uso ────────────────────────────────────────────────────────────────────
 *
 *   # relatório, não escreve nada
 *   DATABASE_URL_MIGRATOR=... node scripts/alinhar-checksums.mjs
 *
 *   # aplica, exigindo que a sentinela do banco seja nomeada
 *   DATABASE_URL_MIGRATOR=... node scripts/alinhar-checksums.mjs \
 *       --aplicar --confirmo conecta/stg
 *
 * O `--confirmo <slug>/<env>` é a mesma trava do `migrate-guarded`: o script lê
 * `app_identity` e aborta se não for o banco nomeado. Escrita na contabilidade
 * do Prisma merece dizer em voz alta em qual banco.
 *
 * O que ele NUNCA faz: inserir linha, apagar linha, tocar linha cujo nome não
 * exista no repositório, ou tocar linha com `rolled_back_at` preenchido. Só
 * reescreve o `checksum` de linha cujo NOME existe aqui e cujo checksum difere.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import pg from 'pg'

const RAIZ = fileURLToPath(new URL('../packages/db/prisma/migrations/', import.meta.url))

const aplicar = process.argv.includes('--aplicar')
const confirmo = process.argv[process.argv.indexOf('--confirmo') + 1]
if (aplicar && (!confirmo || !/^[a-z0-9-]+\/(production|stg)$/.test(confirmo))) {
    console.error(
        'ABORTA: --aplicar exige --confirmo <slug>/<production|stg>.\n' +
        '  Isto escreve na contabilidade do Prisma. Nomeie o banco.',
    )
    process.exit(2)
}

const url = process.env.DATABASE_URL_MIGRATOR
if (!url) {
    console.error('ABORTA: DATABASE_URL_MIGRATOR ausente.')
    process.exit(1)
}

/** Checksum do Prisma: sha256 hex dos bytes do arquivo. Verificado contra
 *  `_prisma_migrations` de produção antes de confiar nisto. */
function checksumDoArquivo(dir) {
    const sql = join(RAIZ, dir, 'migration.sql')
    if (!existsSync(sql)) return null
    return createHash('sha256').update(readFileSync(sql)).digest('hex')
}

const noRepo = new Map()
for (const dir of readdirSync(RAIZ, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const ck = checksumDoArquivo(dir.name)
    if (ck) noRepo.set(dir.name, ck)
}

const cliente = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await cliente.connect()

const { rows: identidade } = await cliente.query('SELECT * FROM app_identity LIMIT 1')
const sentinela = identidade[0]
if (!sentinela) {
    console.error('ABORTA: `app_identity` vazia — banco não identificado.')
    await cliente.end()
    process.exit(1)
}
const alvo = `${sentinela.slug}/${sentinela.environment}`
console.log(`banco: ${alvo}  ·  migrações no repositório: ${noRepo.size}`)

if (aplicar && alvo !== confirmo) {
    console.error(`ABORTA: --confirmo diz "${confirmo}" e o banco é "${alvo}".`)
    await cliente.end()
    process.exit(1)
}

const { rows: aplicadas } = await cliente.query(
    `SELECT migration_name, checksum FROM _prisma_migrations
     WHERE rolled_back_at IS NULL ORDER BY migration_name`,
)

const divergentes = []
const foraDoRepo = []
for (const linha of aplicadas) {
    const esperado = noRepo.get(linha.migration_name)
    if (!esperado) {
        foraDoRepo.push(linha.migration_name)
        continue
    }
    if (esperado !== linha.checksum) divergentes.push({ nome: linha.migration_name, de: linha.checksum, para: esperado })
}
const naoAplicadas = [...noRepo.keys()].filter(
    (n) => !aplicadas.some((l) => l.migration_name === n),
)

console.log(`  aplicadas: ${aplicadas.length}  ·  divergentes: ${divergentes.length}`)
for (const d of divergentes) console.log(`    ~ ${d.nome}\n        ${d.de}\n     →  ${d.para}`)
if (foraDoRepo.length) {
    console.log(`  no banco e NÃO no repositório (${foraDoRepo.length}) — este script não as toca:`)
    for (const n of foraDoRepo) console.log(`    ? ${n}`)
}
/*
 * Pré-voo das PENDENTES — a parte que evita perder um ciclo de build no cutover.
 *
 * Alinhar checksum resolve o passado. O futuro é o que o `migrate deploy` ainda
 * vai aplicar, e aí mora uma armadilha concreta, medida em 17/11: os quatro
 * bancos dos clones têm 2 pendentes, e uma delas é
 * `20261116180000_comentarios_da_renomeacao`, que faz
 * `COMMENT ON VIEW specialists` — view que **só existia no odontobox**. Nos
 * clones a migração falha, e falha DEPOIS de o build inteiro ter rodado.
 *
 * Então, para cada pendente, este trecho extrai os alvos de `COMMENT ON
 * TABLE/VIEW` e de `ALTER TABLE` sem `IF EXISTS` e confere se a relação existe
 * neste banco. Não é análise de SQL — é o subconjunto que falha duro por
 * relação ausente, que é o caso real. Falso negativo é aceito; silêncio sobre o
 * caso conhecido, não.
 */
if (naoAplicadas.length) {
    console.log(`  no repositório e NÃO aplicadas (${naoAplicadas.length}):`)
    const { rows: relacoes } = await cliente.query(
        `SELECT k.relname FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
         WHERE n.nspname = 'public'`,
    )
    const existe = new Set(relacoes.map((r) => r.relname))
    for (const nome of naoAplicadas) {
        const sql = readFileSync(join(RAIZ, nome, 'migration.sql'), 'utf8')
        const semComentario = sql.replace(/^\s*--.*$/gm, '')
        const alvos = new Set()
        const padroes = [
            /\bCOMMENT\s+ON\s+(?:MATERIALIZED\s+VIEW|TABLE|VIEW)\s+"?([A-Za-z_][\w$]*)"?/gi,
            /\bALTER\s+TABLE\s+(?!IF\s+EXISTS)"?([A-Za-z_][\w$]*)"?/gi,
        ]
        for (const p of padroes) for (const m of semComentario.matchAll(p)) alvos.add(m[1])
        const faltando = [...alvos].filter((a) => !existe.has(a))
        if (faltando.length === 0) {
            console.log(`    + ${nome} — o deploy a aplicará`)
        } else {
            console.log(
                `    ✖ ${nome} — VAI FALHAR aqui: relação(ões) ausente(s): ${faltando.join(', ')}\n` +
                `        Se o efeito dela já não se aplica a este banco, marque-a como aplicada\n` +
                `        sem rodar:  pnpm --filter @venn/db exec prisma migrate resolve --applied ${nome}`,
            )
        }
    }
}

if (!aplicar) {
    console.log(divergentes.length ? '\nRelatório. Para escrever, use --aplicar --confirmo ' + alvo : '\nNada a alinhar.')
    await cliente.end()
    process.exit(0)
}

if (divergentes.length === 0) {
    console.log('\nNada a alinhar — nenhuma escrita feita.')
    await cliente.end()
    process.exit(0)
}

/*
 * O retrato ANTES da escrita, gravado em disco — porque sem ele este passo é
 * uma porta de mão única, e não precisa ser.
 *
 * O raciocínio: se um cutover precisar de rollback, o Worker volta a apontar
 * para o repositório antigo — e o `migrate deploy` DE LÁ passaria a reclamar
 * dos mesmos nove checksums, agora ao contrário, porque o banco guarda os deste
 * repositório. O rollback do Worker, sozinho, não desfaz este passo.
 *
 * Com o retrato, desfazer é rodar o SQL que ele carrega. Sem o retrato, seria
 * preciso reconstruir os checksums antigos a partir dos arquivos do repositório
 * antigo — possível, mas no meio de um rollback ninguém quer descobrir isso.
 */
const retrato = {
    banco: alvo,
    quando: new Date().toISOString(),
    antes: divergentes.map((d) => ({ migration_name: d.nome, checksum: d.de })),
    depois: divergentes.map((d) => ({ migration_name: d.nome, checksum: d.para })),
    desfazer: divergentes.map(
        (d) =>
            `UPDATE _prisma_migrations SET checksum = '${d.de}' ` +
            `WHERE migration_name = '${d.nome}' AND checksum = '${d.para}';`,
    ),
}
const arquivoDoRetrato = `alinhar-checksums.${alvo.replace('/', '-')}.${Date.now()}.json`
writeFileSync(arquivoDoRetrato, JSON.stringify(retrato, null, 2) + '\n')
console.log(`\n  retrato de antes gravado em ${arquivoDoRetrato}`)
console.log('  (guarde-o: é o que desfaz este passo se houver rollback do cutover)')

await cliente.query('BEGIN')
let n = 0
for (const d of divergentes) {
    const r = await cliente.query(
        `UPDATE _prisma_migrations SET checksum = $1
         WHERE migration_name = $2 AND checksum = $3 AND rolled_back_at IS NULL`,
        [d.para, d.nome, d.de],
    )
    n += r.rowCount
}
await cliente.query('COMMIT')
console.log(`✔ ${n} checksum(s) alinhado(s) em ${alvo}.`)

const { rows: conferencia } = await cliente.query(
    `SELECT migration_name, checksum FROM _prisma_migrations WHERE rolled_back_at IS NULL`,
)
const restam = conferencia.filter((l) => noRepo.has(l.migration_name) && noRepo.get(l.migration_name) !== l.checksum)
console.log(restam.length ? `✖ ainda divergentes: ${restam.length}` : '✔ conferido: nenhuma divergência restante.')
await cliente.end()
process.exit(restam.length ? 1 : 0)
