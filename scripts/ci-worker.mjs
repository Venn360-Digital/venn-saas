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
 *   - a coleta de lixo do preview quando o PR fecha morreu com o ci.yml:
 *     previews órfãos voltam a acumular e a faxina é manual (`cf previews`).
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
 * O lint de migração precisa de uma base de diff — e o clone do Workers Builds
 * não garante nem a ref `origin/staging` nem profundidade de histórico. A
 * cascata tenta, nesta ordem: a ref já presente; um fetch raso dela; o HEAD~1
 * (padrão do próprio lint). A base só serve se o diff de verdade funcionar
 * (ref presente mas sem merge-base no clone raso falha no diff, não no
 * rev-parse). Sem base nenhuma, o passo é PULADO com aviso alto — reprovar
 * todo PR porque o clone é raso seria pior que cobrar o lint à mão.
 */
function baseParaLintDeMigracoes() {
    const serve = (base) => tenta(`git diff --name-only ${base}...HEAD -- prisma/migrations/`)
    if (serve('origin/staging')) return 'origin/staging'
    if (tenta('git fetch --depth=200 origin staging') && serve('origin/staging')) return 'origin/staging'
    if (serve('HEAD~1')) return 'HEAD~1'
    return null
}

/**
 * Varredura de segredos, pinada na mesma versão que o ci.yml usava. Só roda
 * no Linux (o container do Workers Builds); nesta máquina o aviso diz como
 * rodar à mão. Em clone raso a varredura cobre os commits disponíveis — menos
 * que o histórico inteiro, e o log declara a cobertura em vez de fingir.
 */
function gitleaks() {
    if (process.platform !== 'linux') {
        console.warn('⚠ gitleaks pulado fora do Linux — rode à mão: gitleaks detect --redact --log-opts="--all"')
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
    let raso = false
    try {
        raso = execSync('git rev-parse --is-shallow-repository', { encoding: 'utf8' }).trim() === 'true'
    } catch { /* fora de um repositório git não acontece aqui */ }
    if (raso) console.warn('⚠ clone raso: o gitleaks varre os commits disponíveis, não o histórico inteiro')
    rodar('gitleaks (varredura de segredos)', `${bin} detect --no-banner --redact --log-opts="--all"`)
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
const base = baseParaLintDeMigracoes()
if (base) {
    rodar(`lint de migração (base: ${base})`, `node scripts/lint-migracoes.mjs ${base}`)
} else {
    console.warn(
        '⚠ lint de migração PULADO: o clone não tem base de diff utilizável.\n' +
        '  Com migração no PR, rode à mão: node scripts/lint-migracoes.mjs origin/staging'
    )
}

gitleaks()

// A parte que precisa de banco de verdade, em branch descartável do Neon.
// Sem NEON_API_KEY ela avisa alto e sai verde — ver o cabeçalho do script.
rodar('provas contra o Neon', 'node scripts/ci-neon.mjs')

console.log('\n✔ portão de CI verde')
