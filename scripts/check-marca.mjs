#!/usr/bin/env node
/**
 * A marca está registrada antes de alguém a pedir?
 *
 * `BRAND()` lança se ninguém registrou, e isso é deliberado — devolver uma
 * marca vazia mostraria nome em branco, e devolver um padrão mostraria a marca
 * ERRADA num produto que tem três nichos, calado. Mas uma exceção no arranque
 * só é um bom desfecho se alguém a vir antes do cliente: este verificador é o
 * que a transforma em falha de build.
 *
 * O que ele cobra, e por quê:
 *
 * 1. **A ordem dos imports nos dois pontos de entrada.** O import de um módulo
 *    roda antes do corpo de quem o importa, então `import '@/marca-init'` tem
 *    de estar ACIMA de qualquer import do core — senão um módulo do core pode
 *    ser avaliado primeiro e ler a marca no nível de módulo, antes do
 *    registro. Isso não é teórico: `lib/email/billing.ts` tem quatro `const`
 *    de nível de módulo lendo a marca hoje, e `lib/funil/acoes.ts` tinha um
 *    (virou função preguiçosa justamente por isso).
 * 2. **Os dois pontos, não um.** `app/layout.tsx` cobre o que tem requisição;
 *    `cloudflare/entrada.ts` cobre o que não tem — dez consumidores de fila,
 *    17 crons, três Durable Objects e um Workflow. Quatro dos arquivos que
 *    leem a marca rodam exatamente ali.
 * 3. **`packages/**` nunca importa NADA do app pelo alias `@/`.** É a direção
 *    que o monorepo existe para não ter (`core → app`), e é o que permite ao
 *    `audit:isolation` proibir identificador de app dentro dos pacotes.
 *
 *    Começou olhando só `@/config/brand`, e isso foi estreito demais: 28
 *    arquivos de `packages/core` importavam `@/types/…`, que resolvia para
 *    `src/types/` do app pelo `paths` do tsconfig da raiz — e **compilava
 *    verde**. Eram tipos de domínio no lugar errado, e passariam ao primeiro
 *    app novo: o `paths` global aponta para UM app, então `apps/<outro>/**`
 *    resolveria `@/types` neste. Agora a regra é o alias inteiro, não um
 *    caminho dele.
 *
 *    (E o nome do app irmão não aparece acima de propósito: o
 *    `audit:isolation --strict` reprova identificador de outro app em qualquer
 *    arquivo, comentário incluído — foi assim que ele barrou um `.npmrc` em
 *    13/11, e barrou este cabeçalho na primeira escrita. Comentário copiado
 *    entre repositórios é vetor de vazamento de identidade.)
 * 4. **O provedor de cliente está na raiz.** Os componentes `'use client'` do
 *    core leem a marca por contexto; sem o provedor na raiz, `useMarca()`
 *    lança na primeira tela.
 */
import { readFileSync, existsSync } from 'node:fs'
import { arquivosDeCodigo } from './lib/raizes-de-codigo.mjs'

const ENTRADAS = [
    { arquivo: 'src/app/layout.tsx', cobre: 'tudo que é servido por requisição' },
    { arquivo: 'src/cloudflare/entrada.ts', cobre: 'fila, cron, Durable Object e Workflow' },
    // A partir da Fase 3 estes caminhos passam a ser `apps/<app>/src/...`; a
    // ausência do arquivo é erro, e não silêncio, justamente para cobrar a
    // atualização desta lista no commit que mover.
].map((e) => ({ ...e, existe: existsSync(e.arquivo) }))

let falhas = 0
const erro = (msg) => { console.error(`✖ ${msg}`); falhas++ }

// ── 1 e 2. a ordem do import nos pontos de entrada ───────────────────────
for (const { arquivo, cobre, existe } of ENTRADAS) {
    if (!existe) {
        erro(`ponto de entrada "${arquivo}" não existe (cobre ${cobre}).`)
        console.error('  Se ele mudou de lugar, atualize a lista em scripts/check-marca.mjs')
        console.error('  no mesmo commit que o moveu — sem isto, a verificação passa a provar nada.')
        continue
    }
    const linhas = readFileSync(arquivo, 'utf8').split('\n')
    const imports = linhas
        .map((l, i) => ({ l: l.trim(), i }))
        .filter(({ l }) => l.startsWith('import '))
    const init = imports.findIndex(({ l }) => l.includes('marca-init'))
    if (init === -1) {
        erro(`"${arquivo}" não importa '@/marca-init' (cobre ${cobre}).`)
        continue
    }
    const core = imports.findIndex(({ l }) => l.includes('@venn/core'))
    if (core !== -1 && core < init) {
        erro(`em "${arquivo}" um import de @venn/core vem ANTES de '@/marca-init'.`)
        console.error(`    linha ${imports[core].i + 1}: ${imports[core].l}`)
        console.error(`    linha ${imports[init].i + 1}: ${imports[init].l}`)
        console.error('  O módulo do core pode ler a marca no nível de módulo, antes do registro.')
    }
    if (init !== 0) {
        console.warn(`⚠ em "${arquivo}" o '@/marca-init' é o ${init + 1}º import, não o 1º.`)
        console.warn('  Passa porque nenhum import do core o antecede, mas a margem é de sorte:')
        console.warn('  qualquer um dos de cima pode passar a arrastar o core amanhã.')
    }
}

// ── 3. nenhum pacote importa a marca do app ──────────────────────────────
const dosPacotes = arquivosDeCodigo().filter((f) => f.startsWith('packages/'))
for (const f of dosPacotes) {
    const texto = readFileSync(f, 'utf8')
    // Exige o CONTEXTO de import, e não a simples menção: a primeira versão
    // procurava só a string e reprovou o próprio `packages/core/src/marca.ts`,
    // cujo cabeçalho cita `@/config/brand` para explicar por que o registro
    // existe. Verificador que reclama de comentário ensina a ignorá-lo.
    const alias = texto.match(/(?:from|import|require)\s*\(?\s*['"`](@\/[^'"`]+)['"`]/g)
    if (alias) {
        const quais = [...new Set(alias.map((a) => a.match(/@\/[^'"`]+/)[0]))]
        erro(`"${f}" importa ${quais.map((q) => `'${q}'`).join(', ')} — o alias \`@/\` é do APP.`)
        if (quais.some((q) => q.startsWith('@/config/brand'))) {
            console.error('  Para a marca: `BRAND()` de @venn/core/marca (servidor) ou `useMarca()` (cliente).')
        }
        console.error('  Para o resto: o módulo pertence ao pacote (mova-o) ou ao app (receba-o por parâmetro/props).')
    }
}

// ── 4. o provedor está na raiz ───────────────────────────────────────────
const raiz = ENTRADAS[0]
if (raiz.existe) {
    const texto = readFileSync(raiz.arquivo, 'utf8')
    if (!texto.includes('ProvedorDeMarca')) {
        erro(`"${raiz.arquivo}" não monta o <ProvedorDeMarca>.`)
        console.error('  Sem ele, todo componente de cliente do core que chama useMarca() lança.')
    }
}

if (falhas > 0) {
    console.error(`\n${falhas} problema(s) no registro da marca.`)
    process.exit(1)
}
console.log(
    `registro da marca: ${ENTRADAS.filter((e) => e.existe).length} ponto(s) de entrada em ordem, ` +
    `${dosPacotes.length} arquivo(s) de pacote sem importar nada do app pelo alias`
)
