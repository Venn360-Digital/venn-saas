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
 * Precisa de NEON_API_KEY — Build Variable SECRETA do `odontobox-stg`, no lado
 * **Preview** (não no de produção). São duas configurações: a tela de Settings
 * → Build edita a de produção, e cada preview recebe uma cópia do
 * `previews_base_config`, que NÃO herda segredo. Pôr só na produção faz este
 * script dizer "ausente" em todo build de PR — custou três builds em 14/11.
 * Conferir sem gastar build (o nome aparece com is_secret, ausência é prova):
 *
 *   GET /accounts/{conta}/builds/workers/{script_tag}
 *       → previews_base_config.environment_variables
 *
 * Precisa TAMBÉM de `DATABASE_URL_MIGRATOR` no mesmo lado Preview, desde a
 * separação de papéis de 16/11/2026 — ver a nota na montagem da URI, adiante.
 *
 * Sem a chave, avisa ALTO e sai verde: mesmo contrato do ci.yml, a ausência do
 * segredo não pode reprovar o código. Já a ausência da CREDENCIAL reprova, e a
 * diferença é deliberada: sem `NEON_API_KEY` a prova não começa; sem a
 * credencial ela começou, criou a branch e não tem como seguir — sair verde
 * ali seria apagar a branch e dizer que passou. A string de conexão nunca é
 * impressa.
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
        '⚠ A chave mora nas Build Variables do odontobox-stg, no lado PREVIEW.\n' +
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

/**
 * A URI é MONTADA aqui, não pedida ao Neon — e a razão é a separação de papéis
 * de 16/11/2026.
 *
 * Antes, `resp.connection_uris[0]` funcionava: o Neon emite a URI das roles
 * cuja credencial ele guarda. As roles `{slug}_migrator` e `{slug}_app` foram
 * criadas POR SQL, de propósito — o caminho da API põe a role em
 * `neon_superuser`, com `BYPASSRLS`, `CREATEDB` e `CREATEROLE`, e a Neon avisa
 * que isso não se estreita depois. O preço, medido e registrado no runbook 19,
 * é este: a Neon não conhece a senha delas, `connection_uris` vem vazio, e
 * qualquer ferramenta que peça "a string da role" não a encontra.
 *
 * Trocar para `neondb_owner`, que a Neon conhece, não resolve: ele NÃO é
 * membro do migrador (medido: `pg_has_role` = false), e as 76 tabelas agora
 * pertencem ao migrador — um `ALTER`/`COMMENT` como `neondb_owner` falharia
 * com 42501. A migração tem de rodar como quem é dono.
 *
 * Então a credencial vem de `DATABASE_URL_MIGRATOR` e só o HOST é trocado pelo
 * da branch descartável. A branch é cópia copy-on-write da produção: as roles
 * e as senhas são as mesmas, por construção.
 */
const credencial = process.env.DATABASE_URL_MIGRATOR
if (!credencial) {
    await api('DELETE', `/projects/${PROJETO}/branches/${id}`)
    console.error(
        '✖ DATABASE_URL_MIGRATOR ausente no ambiente de PREVIEW.\n' +
        '  A branch descartável precisa da credencial do migrador: desde a separação\n' +
        '  de papéis, a Neon não emite connection_uri para roles criadas por SQL, e\n' +
        '  `neondb_owner` não é dono das tabelas. Grave a mesma string que o deploy\n' +
        '  de produção usa nas Build Variables do lado Preview.\n' +
        '  A branch descartável foi apagada.'
    )
    process.exit(1)
}
const hostDaBranch = resp.endpoints?.[0]?.host
if (!hostDaBranch) {
    await api('DELETE', `/projects/${PROJETO}/branches/${id}`)
    console.error('✖ a resposta do Neon não trouxe endpoint para a branch nova.')
    process.exit(1)
}
const montada = new URL(credencial)
montada.hostname = hostDaBranch
const uri = montada.toString() // nunca impressa

/**
 * Esperar o host da branch nova ficar ALCANÇÁVEL — e isso não é o mesmo que o
 * endpoint estar `active`.
 *
 * Medido em 16/11/2026, em dois builds: a criação devolve o host na hora, o
 * estado vira `active` em 2,2 s, e o Prisma AINDA falha com
 * `P1001: Can't reach database server`. O que falta não é o compute: é o nome
 * novo resolver no DNS de quem vai conectar. Perguntar ao estado do endpoint
 * responde sobre o lado da Neon; quem precisa alcançar é o builder.
 *
 * Então a espera testa o que o Prisma faria: resolve o nome e abre um socket
 * na 5432. É a mesma lição que atravessa esta fase — verificar a coisa que o
 * runtime faz, não um proxy dela.
 */
const { lookup } = await import('node:dns/promises')
const { connect } = await import('node:net')

function alcancavel(host, ms = 4000) {
    return new Promise((resolve) => {
        const s = connect({ host, port: 5432 })
        const fim = (ok) => { s.destroy(); resolve(ok) }
        s.setTimeout(ms)
        s.once('connect', () => fim(true))
        s.once('timeout', () => fim(false))
        s.once('error', () => fim(false))
    })
}

const LIMITE_MS = 120_000
const inicio = Date.now()
let pronto = false
let ultimoErro = 'ainda não tentado'
while (!pronto) {
    try {
        await lookup(hostDaBranch)
        pronto = await alcancavel(hostDaBranch)
        if (!pronto) ultimoErro = 'DNS resolve, mas a porta 5432 não aceitou conexão'
    } catch (e) {
        ultimoErro = `DNS ainda não resolve (${e.code ?? e.message})`
    }
    if (pronto) break
    if (Date.now() - inicio > LIMITE_MS) {
        await api('DELETE', `/projects/${PROJETO}/branches/${id}`)
        console.error(
            `✖ o host da branch descartável não ficou alcançável em ${LIMITE_MS / 1000}s.\n` +
            `  Último obstáculo: ${ultimoErro}\n  A branch foi apagada.`
        )
        process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 3000))
}
console.log(`  host alcançável em ${((Date.now() - inicio) / 1000).toFixed(1)}s`)

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
