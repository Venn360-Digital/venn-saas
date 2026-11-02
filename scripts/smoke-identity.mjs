#!/usr/bin/env node
/**
 * Smoke test de identidade.
 *
 * Portado dos clones em 01/11/2026 com UMA diferença: aqui a rota é
 * `/api/internal/identity` — o mesmo caminho dos clones. Era
 * `/api/_internal/…`, e o underscore **matava a rota**: no App Router, pasta
 * com prefixo `_` é privada e fica fora do roteamento. Medido em 01/11: o
 * caminho devolvia o mesmo 401 genérico de um caminho inexistente.
 * Copiar sem ajustar dava 404, que pareceria "identidade quebrada".
 *
 * Chama GET https://<host>/api/internal/identity com `x-identity-token` (e, em
 * stg, os headers do service token do Access) e compara a resposta com
 * infra/manifest.json. Divergência → exit 1. É a prova, de fora, de que o deploy
 * aponta para o banco/Evolution/buckets certos — e não para os de outro app.
 *
 * Uso: node scripts/smoke-identity.mjs <production|stg>
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const env = process.argv[2]
if (env !== 'production' && env !== 'stg') {
    console.error("Uso: smoke-identity.mjs <production|stg>")
    process.exit(2)
}

const manifest = JSON.parse(readFileSync('infra/manifest.json', 'utf8'))
const amb = manifest.environments[env]
const slug = manifest.app.slug
const host = amb.hostnames.app
const token = process.env.IDENTITY_TOKEN
if (!token) { console.error('ABORTA: IDENTITY_TOKEN ausente'); process.exit(1) }

const headers = { 'x-identity-token': token }
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
    headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
}

const url = `https://${host}/api/internal/identity`
const falhas = []

const r = await fetch(url, { headers })
if (!r.ok) { console.error(`ABORTA: ${url} → HTTP ${r.status}`); process.exit(1) }
const id = await r.json()

// Conferências contra o manifesto
if (id.app?.slug !== slug) falhas.push(`app.slug ${id.app?.slug} != ${slug}`)
if (id.app?.env !== env) falhas.push(`app.env ${id.app?.env} != ${env}`)
if (id.db?.sentinela?.slug !== slug || id.db?.sentinela?.environment !== env)
    falhas.push(`sentinela ${JSON.stringify(id.db?.sentinela)} != (${slug}, ${env})`)
if (id.db?.host && amb.neon.endpointHost && id.db.host !== amb.neon.endpointHost)
    falhas.push(`db.host ${id.db.host} != ${amb.neon.endpointHost}`)
const evoHost = amb.hostnames.evolution
if (id.evolution?.host && evoHost && id.evolution.host !== evoHost)
    falhas.push(`evolution.host ${id.evolution.host} != ${evoHost}`)

// Nenhum valor pode constar no fingerprint de OUTRO app
const resposta = JSON.stringify(id).toLowerCase()
try {
    for (const f of readdirSync('infra/fingerprints')) {
        if (f === `${slug}.json`) continue
        const fp = JSON.parse(readFileSync(join('infra/fingerprints', f), 'utf8'))
        for (const campo of ['strings', 'hostnames', 'neonEndpoints', 'buckets', 'neonProjectIds']) {
            for (const v of fp[campo] ?? []) {
                if (v && resposta.includes(String(v).toLowerCase()))
                    falhas.push(`resposta contém "${v}" do app "${fp.slug}"`)
            }
        }
    }
} catch {}

if (falhas.length) {
    console.error('SMOKE FALHOU:\n - ' + falhas.join('\n - '))
    process.exit(1)
}
console.log(`Smoke OK: ${host} = ${slug}/${env}, sentinela e hosts conferem.`)
