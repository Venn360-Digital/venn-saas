#!/usr/bin/env node
/**
 * O portão de verificação pré-merge — roda no build de preview do `odontobox-stg`.
 *
 * Substitui o ci.yml do GitHub Actions — removido em 13/11/2026, quando o
 * billing do GitHub provou o que o próprio ci.yml já declarava: nada ali era
 * obrigatório para mesclar, e com a conta travada os PRs saíam sem verificação
 * nenhuma (os quatro merges de 10/11, e o tsc que só apareceu depois do merge).
 * O Workers Builds é quem publica — então é ele quem verifica.
 *
 * Onde isto roda: no build de PREVIEW do Worker `odontobox-stg`, pelo hook
 * `prebuild:preview` — todo push em branch de PR constrói o preview, e o
 * portão roda antes do build, virando o check do PR. Não existe Worker de CI
 * dedicado, por decisão do André em 13/11: a justificativa dele era o teto de
 * 20 min contra um build de vinext de ~12 min (medição de outubro), e essa
 * premissa morreu quando o vinext passou ao rolldown — o build inteiro caiu
 * para ~2-3 min, e a bateria (~8-11 min) cabe com folga. Se o build engordar
 * de volta e encostar no teto, o arranjo dedicado volta: este script não sabe
 * onde roda, é só mudar quem o chama.
 *
 * Localmente: `pnpm run ci:worker` roda tudo menos o gitleaks (binário Linux)
 * e as provas contra o Neon (pedem NEON_API_KEY). A ordem é a do reprova-mais-
 * rápido primeiro; cada passo roda separado para a falha dizer qual foi.
 *
 * O que fica de fora, com motivo (herdado do ci.yml):
 *   - `check:treinamento` é ferramenta manual (pede uma pasta como argumento);
 *   - `check:paridade` tem uma regressão anterior ao portão (T-001, o passo do
 *     onboarding) que precisa de decisão de produto;
 *   - os builds (`build`, `build:vinext`): o Worker de staging compila o
 *     vinext de verdade a cada push de PR — é o build de preview dele;
 *   - a coleta de lixo de preview que o ci.yml fazia ao fechar o PR: ela não é
 *     mais necessária, e eu declarei o contrário por engano ao remover o
 *     workflow. Medido em 14/11: no modelo de Previews novo cada preview tem
 *     `auto_delete: true` e morre junto com a branch (as branches de teste
 *     sumiram da lista ao serem apagadas; os previews restantes correspondem
 *     1:1 a branches vivas). O job servia ao modelo legado, que vazava
 *     namespace de Durable Object.
 */
import { execSync, spawnSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'

let passo = 0
function rodar(nome, comando, env = {}) {
    passo++
    console.log(`\n■ ${passo}. ${nome}\n  $ ${comando}`)
    const t = Date.now()
    const r = spawnSync('bash', ['-ceu', comando], {
        stdio: 'inherit',
        env: { ...process.env, ...env },
    })
    const seg = Math.round((Date.now() - t) / 1000)
    if (r.status !== 0) {
        console.error(`\n✖ reprovou em "${nome}" (${seg}s)`)
        process.exit(r.status ?? 1)
    }
    console.log(`✔ ${nome} (${seg}s)`)
}

function tenta(comando) {
    try {
        execSync(comando, { stdio: 'pipe' })
        return true
    } catch {
        return false
    }
}

/**
 * O lint de migração e o gitleaks precisam de uma BASE de diff — só os commits
 * novos do PR interessam aos dois. O motivo não é estético: vazamento antigo
 * já conferido vive no `.gitleaksignore` com fingerprint preso ao SHA do
 * commit, e no clone raso do builder o mesmo achado reaparece no SHA da
 * fronteira do clone — varrer o histórico inteiro ali reprova TODO PR com os
 * falsos positivos conhecidos de outro carimbo (14 deles, medido em 13/11).
 *
 * O clone do Workers Builds não garante nem a ref `origin/staging` nem
 * profundidade. A cascata tenta: a ref presente; um fetch raso dela; o HEAD~1.
 * A base só serve se o diff de verdade funcionar. Sem base nenhuma, os dois
 * passos são PULADOS com aviso alto E com o diagnóstico de cada tentativa —
 * reprovar todo PR porque o clone é raso seria pior que cobrar à mão.
 */
function baseParaVerificacoesDeDiff() {
    const tentativas = []
    const roda = (cmd) => {
        try {
            return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
        } catch (e) {
            const erro = String(e.stderr ?? e.message).trim().slice(0, 200)
            tentativas.push(`${cmd} → ${erro || 'falhou sem mensagem'}`)
            return null
        }
    }
    // Dois pontos: diff de snapshot, sem exigir merge-base (clone raso não a garante).
    const serve = (base) => roda(`git diff --name-only ${base}..HEAD`) !== null
    let base = null
    if (serve('origin/staging')) base = 'origin/staging'
    else {
        roda('git fetch --depth=200 origin staging:refs/remotes/origin/staging')
        if (serve('origin/staging')) base = 'origin/staging'
        else if (serve('HEAD~1')) base = 'HEAD~1'
    }
    if (!base) {
        console.warn('⚠ nenhuma base de diff utilizável. O que cada tentativa disse:')
        for (const t of tentativas) console.warn(`    ${t}`)
        for (const cmd of ['git remote -v', 'git rev-parse --is-shallow-repository', 'git log --oneline -3', 'git branch -a']) {
            console.warn(`    $ ${cmd}\n      ${(roda(cmd) ?? '(falhou)').trim().split('\n').join('\n      ')}`)
        }
    }
    return base
}

/**
 * Varredura de segredos, pinada na mesma versão que o ci.yml usava — e, como
 * lá, SÓ sobre os commits novos (base..HEAD): o histórico inteiro já foi
 * conferido (allowlist no .gitleaksignore) e revarri-lo no clone raso reprova
 * os falsos positivos conhecidos com fingerprint que não casa (ver a cascata
 * de base acima). A varredura completa vira ato manual ocasional:
 * `gitleaks detect --redact --log-opts="--all"` num clone cheio — rodada em
 * 13/11: zero achados. Só roda no Linux (o binário baixado é o do builder).
 */
function gitleaks(base) {
    if (process.platform !== 'linux') {
        console.warn('⚠ gitleaks pulado fora do Linux — rode à mão: gitleaks detect --redact --log-opts="--all"')
        return
    }
    if (!base) {
        console.warn('⚠ gitleaks PULADO: sem base de diff, varrer o histórico raso reprovaria falso positivo conhecido. Rode à mão num clone cheio.')
        return
    }
    const VERSAO = '8.30.1'
    const dir = 'node_modules/.cache/gitleaks'
    const bin = `${dir}/gitleaks`
    if (!existsSync(bin)) {
        mkdirSync(dir, { recursive: true })
        rodar(
            `baixar gitleaks ${VERSAO}`,
            `curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${VERSAO}/gitleaks_${VERSAO}_linux_x64.tar.gz" | tar -xz -C ${dir} gitleaks`
        )
    }
    if (tenta(`git merge-base --is-ancestor ${base} HEAD`)) {
        rodar(`gitleaks (segredos nos commits novos: ${base}..HEAD)`, `${bin} detect --no-banner --redact --log-opts="${base}..HEAD"`)
        return
    }
    // Sem ancestralidade (clone raso), o range de commits não anda — então o
    // escopo vira o conteúdo ATUAL dos arquivos que o PR altera: um recorte
    // copiado para fora e varrido em dir-mode. É exatamente o que importa
    // pré-merge: segredo novo nos arquivos tocados.
    const arquivos = execSync(`git diff --name-only --diff-filter=ACMR ${base}..HEAD`, { encoding: 'utf8' })
        .split('\n').filter(Boolean)
    if (arquivos.length === 0) {
        console.log('gitleaks: nenhum arquivo alterado ante a base — nada a varrer')
        return
    }
    const recorte = 'node_modules/.cache/gitleaks/recorte'
    execSync(`rm -rf ${recorte} && mkdir -p ${recorte}`)
    for (const a of arquivos) {
        if (existsSync(a)) execSync(`cp --parents ${JSON.stringify(a)} ${recorte}/`)
    }
    rodar(`gitleaks (arquivos alterados ante ${base}: ${arquivos.length})`, `${bin} dir ${recorte} --no-banner --redact`)
}

// ---------------------------------------------------------------------------

rodar('cliente do Prisma', 'pnpm exec prisma generate')

// Os dois typechecks + os quatro verificadores estáticos (71 s medidos) — o
// mesmo `verificar` que os hooks pre* rodam nos builds de verdade.
rodar('verificar (tipos + lints estáticos)', 'pnpm run verificar')

rodar('ESLint', 'pnpm run lint')

// O mesmo modo do portão de deploy: rodar mais frouxo aqui era descobrir a
// reprovação só no deploy.
rodar('auditoria de isolamento', 'pnpm run audit:isolation -- --strict')

// Verificador que ninguém executa é verificador que não existe, com o
// agravante de parecer que existe (`check:trabalhos` ficou meses reprovando
// sem ninguém saber). Prova nova de script puro ENTRA NESTA LISTA.
const PROVAS = [
    // Importa os módulos do core sem registrar a marca: quem a lê na avaliação
    // do módulo quebra o Worker no STARTUP, e isso só aparecia na PUBLICAÇÃO do
    // preview — depois de o build inteiro compilar por 3min22s (14/11). Vem
    // primeiro porque é barato e reprova o erro mais caro da lista.
    'check:marca-tardia',
    // Nomes de recurso: a regra 3 do audit nunca validou nada sem wrangler.
    'check:recursos',
    'check:cofre',
    'check:storage',
    'check:tempo-real',
    'check:envelopes',
    'check:trabalhos',
    'check:operacao',
    'check:period',
    'check:sns',
    'check:sns:assinatura',
    'check:funil',
    'check:gatilhos',
    'test:availability',
    'test:audio',
    'test:chunker',
    'test:consulta',
    'test:treinamento',
    'test:prompt',
    'test:fusao',
    'test:escalada',
    'test:juiz',
    'test:versao',
    'test:agrupar',
    'test:cenarios',
    'test:regras',
    'test:condicoes',
    'test:widget-config',
    'test:fuso-unidade',
    'test:vocabulario',
    'test:distribuicao',
    'test:marcacao',
    'test:mencoes',
    'test:retratos',
    'test:recortes',
    'test:portao',
    'test:convite',
    'test:sonda',
    'test:midia',
    'test:jid',
]
for (const prova of PROVAS) rodar(prova, `pnpm run ${prova}`)

// Com o relógio em UTC — que é como o Worker roda. Na VPS o TZ era
// America/Sao_Paulo e mascarava toda conta de data feita em hora local; o
// container do Workers Builds já é UTC, e o explícito não depende disso.
rodar('check:fuso (relógio em UTC)', 'pnpm run check:fuso', { TZ: 'UTC' })

// Migração nova tem de ser compatível com o código que está no ar: o portão
// APLICA a migração antes de publicar, então DDL destrutivo sem o marcador
// `-- contract` tem de reprovar aqui, onde é barato.
const base = baseParaVerificacoesDeDiff()
if (base) {
    rodar(`lint de migração (base: ${base})`, `node scripts/lint-migracoes.mjs ${base}`)
} else {
    console.warn(
        '⚠ lint de migração PULADO: o clone não tem base de diff utilizável.\n' +
        '  Com migração no PR, rode à mão: node scripts/lint-migracoes.mjs origin/staging'
    )
}

gitleaks(base)

// A parte que precisa de banco de verdade, em branch descartável do Neon.
// Sem NEON_API_KEY ela avisa alto e sai verde — ver o cabeçalho do script.
rodar('provas contra o Neon', 'node scripts/ci-neon.mjs')

console.log('\n✔ portão de CI verde')
