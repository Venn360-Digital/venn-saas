#!/usr/bin/env node
/**
 * T2 — Migração com trava de sentinela.
 *
 * Lê `app_identity` ANTES de migrar e aborta quando o banco não é o esperado.
 * É o que impede rodar a migration de um app no banco de outro — o acidente que
 * numa duplicação apaga ou corrompe os dados errados.
 *
 * Uso:
 *   node scripts/migrate-guarded.mjs --expect-slug <slug> --expect-env <production|stg> [--init]
 *
 * Conecta com DATABASE_URL_MIGRATOR (role de DDL). Passos:
 *  1. Se `app_identity` existe: lê a linha. slug/env != esperado, ou sem linha → ABORTA.
 *  2. Se não existe: banco com qualquer tabela em `public` → ABORTA ("não identificado").
 *     Banco vazio + --init → migra e insere a sentinela. Sem --init → ABORTA.
 *  3. Tudo conferindo → `prisma migrate deploy`.
 */
import { spawnSync } from 'node:child_process'
import pg from 'pg'

function arg(nome) {
    const i = process.argv.indexOf(nome)
    return i >= 0 ? process.argv[i + 1] : undefined
}
const temFlag = (nome) => process.argv.includes(nome)

const expectSlug = arg('--expect-slug')
const expectEnv = arg('--expect-env')
const init = temFlag('--init')

if (!expectSlug || !['production', 'stg'].includes(expectEnv)) {
    console.error('Uso: migrate-guarded --expect-slug <slug> --expect-env <production|stg> [--init]')
    process.exit(2)
}

const url = process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL
if (!url) {
    console.error('ABORTA: DATABASE_URL_MIGRATOR (ou DATABASE_URL) ausente.')
    process.exit(1)
}

// Host sem credencial, para mensagens.
let dbHost = '(desconhecido)'
try {
    dbHost = new URL(url).host
} catch {}

const client = new pg.Client({ connectionString: url })

function abortar(msg) {
    console.error(`ABORTA [${dbHost}]: ${msg}`)
    process.exit(1)
}

function migrar() {
    const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: url },
    })
    process.exit(r.status ?? 1)
}

try {
    await client.connect()

    const existe = await client.query(
        `SELECT to_regclass('public.app_identity') IS NOT NULL AS existe`
    )
    const temSentinela = existe.rows[0].existe

    if (temSentinela) {
        const { rows } = await client.query('SELECT slug, environment FROM app_identity')
        if (rows.length === 0) abortar('app_identity existe mas está vazia — banco não provisionado.')
        const { slug, environment } = rows[0]
        if (slug !== expectSlug || environment !== expectEnv) {
            abortar(
                `sentinela diverge do esperado. esperado=${expectSlug}/${expectEnv} encontrado=${slug}/${environment}`
            )
        }
        await client.end()
        return migrar()
    }

    // Sem sentinela: o banco está vazio?
    const { rows: tabs } = await client.query(
        `SELECT count(*)::int AS n FROM information_schema.tables
         WHERE table_schema='public' AND table_type='BASE TABLE'`
    )
    const vazio = tabs[0].n === 0

    if (!vazio) abortar('sem app_identity e o banco já tem tabelas — banco não identificado.')
    if (!init) abortar('banco vazio e sem --init. Para provisionar: adicione --init.')

    // Banco vazio + --init: migra e grava a sentinela.
    console.log(`[${dbHost}] banco vazio + --init → migrando e gravando sentinela ${expectSlug}/${expectEnv}`)
    const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: url },
    })
    if ((r.status ?? 1) !== 0) {
        await client.end()
        process.exit(r.status ?? 1)
    }
    await client.query('INSERT INTO app_identity (slug, environment) VALUES ($1, $2)', [
        expectSlug,
        expectEnv,
    ])
    await client.end()
    console.log('Sentinela gravada. Provisionamento concluído.')
    process.exit(0)
} catch (e) {
    abortar(`erro inesperado: ${e instanceof Error ? e.message : String(e)}`)
}
