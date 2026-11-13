#!/usr/bin/env node
/**
 * Provas contra o Neon, em branch descartável — a parte do portão de CI que
 * precisa de banco de verdade. Portado do job `banco` do ci.yml; o porquê da
 * mudança de casa está em scripts/ci-worker.mjs.
 *
 * O papel dele é o que foi medido em 06/11: a branch `staging` do Neon tem 1
 * unidade e zero conversas — prova que o DDL aplica, não que um backfill
 * funciona. A branch descartável sai da PRODUÇÃO (dado de verdade) e exercita
 * a migração contra volume real. Branch por execução, não compartilhada: as
 * provas criam e apagam linhas (`check:filas` apaga chaves de idempotência),
 * e duas execuções na mesma branch se atropelariam. Copy-on-write: custo
 * próximo de zero.
 *
 * Precisa de NEON_API_KEY — Build Variable SECRETA do Worker `odontobox-ci`.
 * Sem a chave, avisa ALTO e sai verde: mesmo contrato do ci.yml, a ausência do
 * segredo não pode reprovar o código. A string de conexão nunca é impressa.
 *
 * O teto de 20 min do Workers Builds pode matar o build no meio e deixar uma
 * branch órfã — por isso toda execução começa recolhendo branches `ci-wb-*`
 * com mais de 2 horas.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PROJETO = 'polished-shape-42069569'
const CHAVE = process.env.NEON_API_KEY

if (!CHAVE) {
    console.warn(
        '⚠'.repeat(30) +
        '\n⚠ NEON_API_KEY ausente — provas contra o banco PULADAS.\n' +
        '⚠ Migração contra dado de verdade NÃO foi exercitada neste build.\n' +
        '⚠ A chave mora nas Build Variables (secreta) do Worker odontobox-ci.\n' +
        '⚠'.repeat(30)
    )
    process.exit(0)
}

async function api(metodo, caminho, corpo) {
    const r = await fetch(`https://console.neon.tech/api/v2${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
    })
    if (!r.ok) throw new Error(`Neon: ${metodo} ${caminho} → ${r.status} ${await r.text()}`)
    return r.json()
}

function rodar(nome, comando, env) {
    console.log(`\n  → ${nome}`)
    const r = spawnSync('bash', ['-ceu', comando], {
        stdio: 'inherit',
        env: { ...process.env, ...env },
    })
    if (r.status !== 0) throw new Error(`reprovou em "${nome}"`)
}

async function recolherOrfas() {
    const { branches } = await api('GET', `/projects/${PROJETO}/branches`)
    const limite = Date.now() - 2 * 60 * 60 * 1000
    for (const b of branches) {
        if (b.name.startsWith('ci-wb-') && new Date(b.created_at).getTime() < limite) {
            console.warn(`  recolhendo branch órfã de um build morto: ${b.name}`)
            await api('DELETE', `/projects/${PROJETO}/branches/${b.id}`)
        }
    }
}

await recolherOrfas()

const nome = `ci-wb-${process.env.WORKERS_CI_BUILD_UUID ?? Date.now()}`
console.log(`  criando a branch descartável ${nome}`)
const resp = await api('POST', `/projects/${PROJETO}/branches`, {
    branch: { name: nome },
    endpoints: [{ type: 'read_write' }],
})
const id = resp.branch.id
const uri = resp.connection_uris[0].connection_uri // nunca impressa

try {
    const ambiente = {
        DATABASE_URL: uri,
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        // Segredo descartável: nenhuma sessão criada aqui sobrevive à branch.
        BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    }
    rodar('migrações', 'pnpm exec prisma migrate deploy', ambiente)
    for (const prova of ['check:neon', 'check:auth', 'check:filas', 'check:tenant']) {
        rodar(prova, `pnpm run ${prova}`, ambiente)
    }
} finally {
    // A branch tem de sair mesmo quando a prova falha, senão cada execução
    // vermelha deixa uma para trás.
    await api('DELETE', `/projects/${PROJETO}/branches/${id}`)
    console.log(`  branch ${nome} apagada`)
}

console.log('✔ provas contra o Neon verdes')
