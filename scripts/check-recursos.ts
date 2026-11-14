/**
 * Os nomes de recurso que o deploy vai usar são os que existem na conta?
 *
 * ## Por que isto existe
 *
 * O `audit-isolation` tem uma regra para isso — a regra 3, "tem no wrangler um
 * ID/bucket/rota/nome de Worker que não pertence ao ambiente certo do
 * manifesto". Ela **nunca validou nada desde a migração para `cf`**: não existe
 * `wrangler.jsonc` no repositório, e a regra começa com
 * `if (!wranglerFile) { warn('…validação de bindings ignorada'); }`. O aviso
 * sai em todo build, entre dezenas de linhas verdes, há semanas.
 *
 * Então os nomes de fila, bucket e Worker são escritos à mão em DOIS lugares —
 * `infra/manifest.json` e `apps/<app>/cloudflare.config.ts` — e nada compara os
 * dois. O config apenas *menciona* o manifesto em comentários.
 *
 * ## O erro concreto que isto impede
 *
 * Medido em 14/11/2026, ao preparar o 2º app: o prefixo dos recursos **não
 * segue o mesmo padrão nos três apps**, e a conta é a prova (120 filas, 13
 * buckets lidos pela API):
 *
 *     app        Worker prod   prefixo de recursos em produção
 *     odontobox  odontobox     odontobox        ← sem sufixo
 *     stagent    stagent       stagent-prod
 *     conecta    conecta       conecta-prod
 *
 * Copiar o molde do 1º app e trocar só o nome daria
 * `stagent-whatsapp-inbound` em produção — fila que não existe. O `cf` a
 * criaria, vazia, e as mensagens em voo nas filas reais ficariam sem
 * consumidor. Isso é a "identidade irreversível" que o plano manda preservar, e
 * é um erro que só apareceria no cutover.
 *
 * ## O que ele afirma
 *
 * 1. Cada ambiente tem UM prefixo: todos os recursos dele começam igual. Se
 *    não, o manifesto está misturando ambientes.
 * 2. Produção e homologação têm prefixos DIFERENTES — é o isolamento que o
 *    `_isolation` do manifesto declara, afirmado em vez de descrito.
 * 3. O `cloudflare.config.ts` do app contém, como literal, o prefixo derivado
 *    do manifesto. É textual de propósito e com fail-fast: o config importa o
 *    entrypoint com `with { type: 'cf-worker' }`, atributo que só o bundler da
 *    Cloudflare entende, então o Node não consegue avaliá-lo para perguntar.
 *    Entre não verificar e verificar pelo texto exato que o deploy usa, o texto
 *    vale mais — e quando não casa, a mensagem diz qual prefixo era esperado.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MANIFEST = 'infra/manifest.json'

let falhas = 0
function ok(nome: string, condicao: boolean, detalhe = '', seFalhar = '') {
    const nota = condicao ? detalhe : (seFalhar || detalhe)
    console.log(`${condicao ? 'PASS' : 'FAIL'}  ${nome}${nota ? `  — ${nota}` : ''}`)
    if (!condicao) falhas++
}

type Recurso = { name: string }
type Ambiente = {
    cloudflare: { worker: string; queues?: Recurso[]; r2?: Recurso[]; kv?: Recurso[] }
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    app: { slug: string }
    environments: Record<string, Ambiente>
}

/** O prefixo comum a todos os recursos do ambiente, ou null se não houver um. */
function prefixoDe(amb: Ambiente): { prefixo: string | null; nomes: string[] } {
    const cf = amb.cloudflare
    const nomes = [...(cf.queues ?? []), ...(cf.r2 ?? []), ...(cf.kv ?? [])].map((r) => r.name)
    if (nomes.length === 0) return { prefixo: null, nomes }
    let comum = nomes[0]
    for (const n of nomes.slice(1)) {
        while (comum.length > 0 && !n.startsWith(comum)) comum = comum.slice(0, -1)
    }
    const prefixo = comum.replace(/-+$/, '')
    return { prefixo: prefixo.length >= 3 ? prefixo : null, nomes }
}

/** A pasta do app cujo slug é o do manifesto — derivada, não escrita. */
function pastaDoApp(slug: string): string {
    const candidatas = existsSync('apps')
        ? readdirSync('apps').filter((n) => n.startsWith(slug) && existsSync(join('apps', n, 'cloudflare.config.ts')))
        : []
    if (candidatas.length === 1) return join('apps', candidatas[0])
    throw new Error(
        candidatas.length === 0
            ? `não achei pasta em apps/ começando por "${slug}" com cloudflare.config.ts.`
            : `"${slug}" casa com ${candidatas.length} pastas: ${candidatas.join(', ')} — ambíguo.`
    )
}

const ambientes = Object.entries(manifest.environments)
ok(
    'o manifesto declara os dois ambientes',
    ambientes.length >= 2 && ambientes.some(([n]) => n === 'production') && ambientes.some(([n]) => n === 'stg'),
    ambientes.map(([n]) => n).join(', ')
)

const prefixos = new Map<string, string>()
for (const [nome, amb] of ambientes) {
    const { prefixo, nomes } = prefixoDe(amb)
    ok(
        `${nome}: todos os ${nomes.length} recursos partilham um prefixo`,
        prefixo !== null,
        prefixo ?? `sem prefixo comum entre ${nomes.slice(0, 3).join(', ')}…`
    )
    if (prefixo) prefixos.set(nome, prefixo)
}

ok(
    'produção e homologação usam prefixos diferentes',
    new Set(prefixos.values()).size === prefixos.size,
    [...prefixos].map(([a, p]) => `${a}=${p}`).join('  ')
)

const pasta = pastaDoApp(manifest.app.slug)
const config = readFileSync(join(pasta, 'cloudflare.config.ts'), 'utf8')
for (const [nome, prefixo] of prefixos) {
    ok(
        `o config do app escreve o prefixo de ${nome}`,
        config.includes(`'${prefixo}'`) || config.includes(`\`${prefixo}`) || config.includes(`"${prefixo}"`),
        prefixo,
        `${pasta}/cloudflare.config.ts não contém "${prefixo}" — é o nome que a conta TEM, e o deploy criaria outro`
    )
}

for (const [nome, amb] of ambientes) {
    ok(
        `${nome}: o nome do Worker aparece no config`,
        config.includes(`'${amb.cloudflare.worker}'`) || config.includes(`\`${amb.cloudflare.worker}`),
        amb.cloudflare.worker
    )
}

console.log('')
if (falhas > 0) {
    console.log(`FALHOU: ${falhas} divergência(s) entre o manifesto e o config de deploy.`)
    console.log('Nome de fila, bucket ou Worker errado não falha no build: o `cf` CRIA o recurso,')
    console.log('vazio, e o que estava em voo nas filas reais fica sem consumidor.')
    process.exit(1)
}
console.log(`OK: ${prefixos.size} ambiente(s) coerentes entre manifesto e ${pasta}/cloudflare.config.ts.`)
process.exit(0)
