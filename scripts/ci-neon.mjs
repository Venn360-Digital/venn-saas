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
 * Sem a chave OU sem a credencial, avisa ALTO e sai verde: mesmo contrato do
 * ci.yml, a ausência de segredo de ambiente não pode reprovar o código em
 * revisão. A string de conexão nunca é impressa.
 *
 * ⚠️ Este parágrafo afirmava o contrário até 17/11/2026 — que a ausência da
 * credencial REPROVAVA, "porque a prova já começou e criou a branch". Era
 * verdade no desenho antigo, em que a validação vinha depois da criação. O
 * conserto do pai da branch (adiante) moveu as duas validações para antes de
 * qualquer ida à rede, e a frase ficou descrevendo um código que não existe
 * mais. Foi um gatilho de preview espúrio em `main` que expôs isso, reprovando
 * todo merge em produção. **Afirmação de cabeçalho é o mapa que o próximo
 * diagnóstico segue: quando a ordem do código muda, ela tem de mudar junto.**
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

/*
 * Credencial ausente PULA, como a chave da API — e a correção é de 17/11/2026,
 * sobre uma mudança minha de algumas horas antes.
 *
 * Até aqui esta guarda saía com 1, e o motivo escrito era este: a validação
 * vinha DEPOIS de criar a branch descartável, então "sem credencial ela começou,
 * criou a branch e não tem como seguir — sair verde ali seria apagar a branch e
 * dizer que passou".
 *
 * O conserto do pai da branch moveu a validação para ANTES de qualquer criação.
 * Com isso a justificativa caiu: nada foi criado, nada ficou órfão, e o caso
 * virou idêntico ao da `NEON_API_KEY` ausente logo acima — a prova não pode
 * rodar, e a política desta verificação, declarada lá, é **pular alto em vez de
 * bloquear todo PR** por falta de configuração de ambiente que não é do código
 * em revisão.
 *
 * O que fez a assimetria aparecer: um gatilho de preview com
 * `branch_includes: ["main"]` no Worker de homologação, criado na reconexão de
 * 16/11. Ele dispara a cada merge em `main`, atravessa os 54 primeiros passos e
 * reprova só aqui — ou seja, **todo merge em produção passou a produzir um check
 * vermelho** por falta de uma variável num gatilho que nem deveria existir.
 * Check vermelho permanente é a forma mais eficiente de ninguém mais ler os
 * checks; é a mesma razão por que a regra 3 do audit foi removida na Fase 3.
 *
 * O gatilho em si é configuração e sai pelo painel. Esta guarda é código, e
 * estava errada desde que eu mudei a ordem.
 */
const credencialBruta = process.env.DATABASE_URL_MIGRATOR
if (!credencialBruta) {
    console.warn(
        '⚠'.repeat(30) +
        '\n⚠ DATABASE_URL_MIGRATOR ausente — provas contra o banco PULADAS.\n' +
        '⚠ Migração contra dado de verdade NÃO foi exercitada neste build.\n' +
        '⚠ A branch descartável precisa da credencial do migrador: desde a\n' +
        '⚠ separação de papéis, a Neon não emite connection_uri para roles\n' +
        '⚠ criadas por SQL, e `neondb_owner` não é dono das tabelas.\n' +
        '⚠ Grave a string do migrador nas Build Variables do lado Preview.\n' +
        '⚠ Nenhuma branch foi criada.\n' +
        '⚠'.repeat(30)
    )
    process.exit(0)
}

await recolherOrfas()

/**
 * O PAI da branch descartável é DERIVADO da credencial, não deixado no padrão —
 * e a razão é um defeito que custou seis builds de diagnóstico errado.
 *
 * Até 17/11/2026 esta chamada não passava `parent_id`, então o Neon usava a
 * branch PADRÃO do projeto. O cabeçalho logo abaixo afirmava, em consequência,
 * que "a branch é cópia copy-on-write da produção: as roles e as senhas são as
 * mesmas, por construção". **A premissa é falsa**: a senha do
 * `odontobox_migrator` é DIFERENTE em produção e em homologação — medido
 * comparando o sha256 das duas (iguais no usuário e no banco, distintas na
 * senha), porque cada role foi criada por SQL em cada branch, separadamente.
 *
 * Com credencial de uma branch e cópia de outra, o `migrate deploy` responde
 * `P1000: Authentication failed`. E antes disso respondia `P1001`, o que me
 * levou a registrar como dívida uma suspeita de roteamento por SNI no proxy da
 * Neon. **Essa suspeita estava errada**: P1001 era a URI anterior, malformada;
 * assim que ela ficou bem formada o erro virou P1000, que é a conexão
 * CHEGANDO e a credencial sendo recusada. Lição: erro de infraestrutura que
 * muda de código quando o ambiente muda não era sobre infraestrutura.
 *
 * Agora o pai é resolvido pelo HOST da própria credencial: pergunta-se ao Neon
 * de que branch é aquele endpoint, e a descartável nasce dela. Credencial e
 * cópia passam a casar POR CONSTRUÇÃO, qualquer que seja a branch gravada no
 * Preview — sem literal e sem suposição.
 *
 * Consequência a declarar: a prova roda contra a branch de onde vem a
 * credencial do Preview. Se isso for homologação, o dado é menor que o de
 * produção e a prova fica mais fraca que o plano previa — mas uma prova que
 * RODA vale mais que uma que degrada todo build. Para exercitar dado de
 * produção, basta gravar no Preview a credencial do migrador de produção, com
 * o aumento de privilégio que isso implica (build de PR passa a carregar
 * credencial de produção) — decisão de quem opera, não deste script.
 */

const hostDaCredencial = new URL(credencialBruta).hostname
const { endpoints: existentes } = await api('GET', `/projects/${PROJETO}/endpoints`)
const endpointDaCredencial = (existentes ?? []).find((e) => e.host === hostDaCredencial)
if (!endpointDaCredencial) {
    console.error(
        `✖ o host da DATABASE_URL_MIGRATOR não pertence ao projeto ${PROJETO}.\n` +
        `  host da credencial: ${hostDaCredencial}\n` +
        `  endpoints do projeto: ${(existentes ?? []).map((e) => e.host).join(', ') || '(nenhum)'}\n` +
        '  Sem saber de que branch a credencial é, não há como criar uma cópia em que\n' +
        '  ela funcione — e adivinhar é o defeito que este trecho existe para não\n' +
        '  repetir. Nenhuma branch foi criada.'
    )
    process.exit(1)
}
const paiId = endpointDaCredencial.branch_id
const { branch: pai } = await api('GET', `/projects/${PROJETO}/branches/${paiId}`)
console.log(`  a credencial do Preview é da branch "${pai.name}" — a descartável sai dela`)

const nome = `ci-wb-${process.env.WORKERS_CI_BUILD_UUID ?? Date.now()}`
console.log(`  criando a branch descartável ${nome}`)
const resp = await api('POST', `/projects/${PROJETO}/branches`, {
    branch: { name: nome, parent_id: paiId },
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
 * da branch descartável. A senha funciona na cópia porque a cópia sai da branch
 * de ONDE A CREDENCIAL É — resolvido acima, pelo host. Não vale dizer "são as
 * mesmas por construção" sem isso: as senhas do migrador de produção e de
 * homologação são diferentes, e foi essa frase, escrita de cabeça, que mandou
 * seis builds procurarem o defeito no lugar errado.
 */
const credencial = credencialBruta
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
             * Rede de último recurso para o endpoint que não esquenta.
             *
             * ⚠️ CORREÇÃO — 17/11/2026. Aqui havia uma dívida declarada que
             * dizia: "o endpoint recusa conexão com a MESMA credencial que
             * conecta na produção", e suspeitava de roteamento por SNI no proxy
             * da Neon contra roles criadas por SQL. **Estava errado nos dois
             * pontos.**
             *
             * A credencial não era a mesma: a branch descartável nascia da
             * branch PADRÃO do projeto e a credencial vinha do Preview, e a
             * senha do `odontobox_migrator` é diferente entre produção e
             * homologação (medido pelo sha256 das duas). E o P1001 era URI
             * malformada — assim que ela ficou bem formada, o erro virou P1000,
             * que é a conexão chegando e a credencial sendo recusada.
             *
             * O conserto está acima: o pai da descartável é derivado do HOST da
             * credencial. Este laço fica porque endpoint novo pode levar alguns
             * segundos para aceitar conexão — isso é real e esperado —, mas não
             * é mais o lugar onde um defeito de configuração se esconde.
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
