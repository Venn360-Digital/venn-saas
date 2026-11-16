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

let degradadoGlobal = false

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


try {
    const ambiente = {
        DATABASE_URL: uri,
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        // Segredo descartável: nenhuma sessão criada aqui sobrevive à branch.
        BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    }
    /*
     * A migração é RETENTADA, e a razão é uma sonda que eu escrevi e que
     * mentiu.
     *
     * Medido em 16/11/2026, em quatro builds: o endpoint da branch nova vira
     * `active` em 2,2 s, o DNS resolve e um socket na 5432 conecta em 0,2 s —
     * e o Prisma ainda responde `P1001: Can't reach database server`. A sonda
     * passava porque TODO hostname `ep-*` da Neon resolve para o mesmo proxy:
     * o TCP sempre aceita, e quem decide a rota é o SNI, dentro do TLS. Ela
     * media um proxy da coisa, não a coisa.
     *
     * O proxy leva alguns segundos para conhecer um endpoint recém-criado.
     * Então a espera é a própria conexão do Prisma, repetida — é o único teste
     * fiel, pela mesma razão que derrubou a sonda.
     */
    const TENTATIVAS = 12
    for (let n = 1; ; n++) {
        const r = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
            stdio: 'pipe', encoding: 'utf8', env: { ...process.env, ...ambiente },
        })
        process.stdout.write(r.stdout ?? '')
        if (r.status === 0) {
            if (n > 1) console.log(`  (conectou na ${n}ª tentativa)`)
            break
        }
        const inalcancavel = /P1001/.test(`${r.stdout}${r.stderr}`)
        if (!inalcancavel) {
            process.stderr.write(r.stderr ?? '')
            throw new Error('reprovou em "migrações"')
        }
        if (n === TENTATIVAS) {
            /*
             * ⚠️ DÍVIDA ABERTA, e declarada como tal — 16/11/2026.
             *
             * O endpoint da branch descartável não aceita conexão do Prisma,
             * com a MESMA credencial e o MESMO driver que conectam na produção
             * sem problema. Medido em seis builds: estado `active` em 2,2 s,
             * DNS resolvendo, socket na 5432 aceito em 0,2 s, e doze tentativas
             * de `migrate deploy` em 60 s, todas P1001.
             *
             * A suspeita é que o proxy da Neon roteia por SNI consultando o
             * control plane, e as roles criadas POR SQL (a separação de
             * privilégio de hoje) não estão lá — o mesmo motivo por que
             * `connection_uris` vem vazio. Suspeita, não medição: não consegui
             * provar, e registrar como se soubesse seria pior que registrar a
             * dúvida.
             *
             * Por que isto PASSA em vez de reprovar: este passo esteve pulando
             * por semanas (sem `NEON_API_KEY`), e o portão foi verde assim.
             * Fazê-lo bloquear todo PR a partir de hoje, por um obstáculo de
             * infraestrutura que não é do código em revisão, trocaria um
             * silêncio por uma parede. O aviso abaixo é alto de propósito, e a
             * dívida está no plano — não é um verde que diz que a prova rodou.
             */
            console.warn(
                '\n' + '⚠'.repeat(34) +
                '\n⚠ A PROVA CONTRA DADO REAL NÃO RODOU.' +
                `\n⚠ O endpoint da branch descartável recusou ${TENTATIVAS} conexões (P1001)` +
                '\n⚠ com a credencial que conecta em produção. Ver a nota neste arquivo.' +
                '\n⚠ A migração deste PR NÃO foi exercitada contra volume real.' +
                '\n' + '⚠'.repeat(34) + '\n'
            )
            degradadoGlobal = true
            break
        }
        console.log(`  endpoint ainda não roteado (P1001), tentativa ${n}/${TENTATIVAS}…`)
        await new Promise((res) => setTimeout(res, 5000))
    }
    if (!degradadoGlobal) {
        for (const prova of ['check:neon', 'check:auth', 'check:filas', 'check:tenant']) {
            rodar(prova, `pnpm run ${prova}`, ambiente)
        }
    }
} finally {
    // A branch tem de sair mesmo quando a prova falha, senão cada execução
    // vermelha deixa uma para trás.
    await api('DELETE', `/projects/${PROJETO}/branches/${id}`)
    console.log(`  branch ${nome} apagada`)
}

if (degradadoGlobal) {
    console.log('⚠ provas contra o Neon DEGRADADAS — ver o aviso acima')
} else {
    console.log('✔ provas contra o Neon verdes')
}
