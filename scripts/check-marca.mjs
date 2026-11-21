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
 * 4. **Todo script que exercita o core registra a marca de teste.** Ver a
 *    nota na regra 5, abaixo — foi um build reprovado.
 * 5. **O provedor de cliente está na raiz.** Os componentes `'use client'` do
 *    core leem a marca por contexto; sem o provedor na raiz, `useMarca()`
 *    lança na primeira tela.
 * 6. **Nenhum componente de cliente chama `BRAND()`.** É o complemento exato da
 *    regra 5: ela garante que o provedor existe, esta garante que ninguém passa
 *    por fora dele. O registro de módulo mora no servidor — `marca-init` é
 *    importado pelo `layout.tsx` (RSC) e pelo entrypoint do Worker, e nenhum
 *    dos dois é avaliado no navegador. Então `BRAND()` num arquivo
 *    `'use client'` **compila, builda, publica** e lança na tela do cliente,
 *    que é a pior ordem possível de descobrir.
 *
 *    Foi um defeito meu, hoje: ao converter oito rotas de `@/config/brand`
 *    (objeto literal do app) para o registro do core, três eram
 *    `'use client'`. Nenhuma rede pegava — `check:marca-tardia` só olha a
 *    AVALIAÇÃO do módulo, e esta leitura acontece no render.
 *
 *    O critério é o import do módulo de registro, não o nome da função: a
 *    lição desta fase é que lista de nomes diverge calada (`APP()` e `appUrl()`
 *    leem a marca sem escrever `BRAND(`). Importar `@venn/core/marca` é o que
 *    o runtime usa.
 *
 *    ⚠️ **A diretiva não é o bundle, e essa diferença custou quatro defeitos
 *    em produção.** A leitura também chega ao navegador de forma TRANSITIVA:
 *    um módulo sem `'use client'`, importado por um que a tem, é avaliado no
 *    cliente igual. Eu havia medido esse fechamento à mão e escrito aqui
 *    "273 módulos alcançáveis, zero importando o registro" — e uma medição
 *    anotada em comentário **não é uma rede**. A varredura de vocabulário
 *    entrou depois e pôs `vocab()` dentro de `plans`, `terms`,
 *    `deal-lanes`, `product-categories`, `galeria`, `modelos` e
 *    `agent-creation`, todos alcançados por componentes de cliente. Resultado,
 *    medido em 15/11/2026: `TERMS()`, `planList()`, `redesDoPlano()` e
 *    `DOCUMENTOS()` lançavam `MarcaNaoRegistradaError` na hidratação — a tela
 *    de termos, o passo 2 do onboarding, a guia Plano e o treinamento do
 *    agente, tudo publicado e verde.
 *
 *    Então a regra 6 passou a CALCULAR o fechamento a cada execução, com o
 *    mesmo critério que o bundler usa (import de valor; `import type` é
 *    apagado na compilação). O conserto do código é o compilador: os módulos
 *    recebem o vocabulário por parâmetro obrigatório, e não há mais o que
 *    esquecer. Esta regra é o que impede a volta.
 *
 *    `config/app.ts` continua tendo dono próprio — o `import 'server-only'`,
 *    que o bundler transforma em erro de build — e por isso ele aparece no
 *    fechamento sem ser defeito.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { arquivosDeCodigo, exigirPiso, conferirAllowlist } from './lib/raizes-de-codigo.mjs'

/**
 * Os dois pontos de entrada DE CADA APP, derivados — não listados.
 *
 * Eram dois caminhos fixos em `src/`, e a ausência deles era erro de propósito:
 * foi assim que este verificador cobrou a atualização no commit que moveu o app
 * para `apps/odontobox360/`. Mas listar à mão não escala para três apps — seria
 * seis linhas repetindo a mesma decisão, e a sétima esquecida quando entrar o
 * quarto app. Agora os apps são descobertos, e cada um responde pelos seus dois
 * pontos.
 *
 * Um app sem `app/layout.tsx` ou sem `cloudflare/entrada.ts` é erro: os dois
 * existem em todo app por construção, e a falta de um significa que o app está
 * incompleto ou que a convenção mudou — nenhum dos dois pode passar calado.
 */
function appsDoRepo() {
    if (!existsSync('apps')) return []
    return readdirSync('apps')
        .filter((a) => !a.startsWith('_') && existsSync(join('apps', a, 'src')))
        .sort()
}

const ENTRADAS = appsDoRepo().flatMap((app) => [
    { arquivo: join('apps', app, 'src', 'app', 'layout.tsx'), cobre: `${app}: o que é servido por requisição` },
    { arquivo: join('apps', app, 'src', 'cloudflare', 'entrada.ts'), cobre: `${app}: fila, cron, Durable Object e Workflow` },
]).map((e) => ({ ...e, existe: existsSync(e.arquivo) }))

if (ENTRADAS.length === 0) {
    console.error('✖ nenhum app encontrado em `apps/` — não há o que verificar, e isso não é sucesso.')
    process.exit(1)
}

/**
 * O script importa algo de `@venn/core`?
 *
 * Pela LINHA, não pelo texto inteiro: um import estático começa a linha, e um
 * import multi-linha termina em `} from '…'`. Um especificador escrito no meio
 * de uma chamada — o que o gerador de rotas faz — não casa nenhuma das duas.
 *
 * Import dinâmico conta também — são quatro os scripts que usam um
 * (`check-tempo-real`, `check-trabalhos`, `check-auth`), e o core avaliado
 * tarde pede a marca do mesmo jeito. Aqui a forma é inconfundível:
 * `import(` com o especificador logo dentro.
 */
function importaDoCore(texto) {
    return texto.split('\n').some((l) => {
        const t = l.trim()
        if (!/['"]@venn\/core/.test(t)) return false
        if (/import\s*\(\s*['"]@venn\/core/.test(t)) return true
        return t.startsWith('import ') || /^\}\s*from\s*['"]/.test(t)
    })
}

/**
 * O script REGISTRA a marca de teste — pelo import, não pela menção.
 *
 * Era `texto.includes('marca-de-teste')`, e isso é falso negativo garantido:
 * `check-auth.ts` cita o arquivo num comentário acima do import ("Ver
 * `./lib/marca-de-teste.ts`"), então apagar o import deixava a regra passar.
 * Verificado: com o import removido e o comentário no lugar, a regra aprovava
 * — exatamente o build que ela existe para não deixar quebrar.
 */
function registraMarcaDeTeste(texto) {
    return texto.split('\n').some((l) => {
        const t = l.trim()
        return t.startsWith('import ') && t.includes('marca-de-teste')
    })
}

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
for (const { arquivo, existe } of ENTRADAS.filter((e) => e.arquivo.endsWith('layout.tsx'))) {
    if (!existe) continue
    if (!readFileSync(arquivo, 'utf8').includes('ProvedorDeMarca')) {
        erro(`"${arquivo}" não monta o <ProvedorDeMarca>.`)
        console.error('  Sem ele, todo componente de cliente do core que chama useMarca() lança.')
    }
}

// ── 5. script que exercita o core registra a marca de teste ─────────────
//
// O core PEDE a marca, e um script de verificação não tem ponto de entrada de
// app que a registre. Foi assim que o build reprovou em 14/11: `check:auth`
// chama `getAuth()` → `APP()` → `BRAND()`, e lançou `MarcaNaoRegistradaError`
// depois de 11 PASS. Só aparecia no builder, porque esse check roda dentro das
// provas contra o Neon, que pedem `NEON_API_KEY`.
for (const f of readdirSync('scripts').filter((n) => n.endsWith('.ts'))) {
    const caminho = join('scripts', f)
    const texto = readFileSync(caminho, 'utf8')
    // Um import de verdade, não uma string que se parece com um — e foram
    // três tentativas, com os dois tipos de erro, que é o que vale registrar:
    //
    //   1. `texto.includes('@venn/core')` reprovou `gerar-rotas.ts`, que só
    //      cita o nome do pacote dentro dos wrappers que escreve. Falso
    //      positivo: barato, aparece na hora.
    //   2. Exigir a declaração no início da linha deixou de cobrar
    //      `check-auth.ts` com a linha de registro removida. **Falso
    //      negativo** — o lado caro: a regra passaria a aprovar exatamente o
    //      caso que ela existe para pegar, e foi esse caso que reprovou um
    //      build em 14/11.
    //   3. Apagar comentários e template literals antes de procurar pareceu a
    //      saída, e não é: o gerador tem um backtick ÍMPAR dentro de `['\"`]`
    //      num regex, e isso desalinha o pareamento de todos os templates
    //      seguintes. Remover literal de string por expressão regular é
    //      aproximação, não análise.
    //
    // `importaDoCore` olha a LINHA: declaração estática começa a linha, e um
    // import multi-linha fecha com `} from '…'`. O especificador que o gerador
    // escreve está no meio de uma chamada, e nenhuma das duas formas o alcança.
    if (!importaDoCore(texto)) continue
    if (!registraMarcaDeTeste(texto)) {
        erro(`"${caminho}" importa de @venn/core e não registra a marca de teste.`)
        console.error("  Acrescente `import './lib/marca-de-teste.ts'` como PRIMEIRO import.")
    }
}

// ── 6. nada no bundle do cliente chama o registro ───────────────────────
//
// As sementes são DERIVADAS (quem tem a diretiva) e o fechamento é CALCULADO,
// pelo mesmo critério do bundler. Os dois pisos existem porque varredura que
// não encontra nada reporta sucesso — foi assim que a guarda de uma conexão
// por aba ficou oca por uma fase inteira.
const DO_CONTEXTO = ['packages/core/src/marca-contexto.tsx']

/**
 * Módulos cujo dono é outra rede, e que por isso podem estar no fechamento.
 *
 * `config/app.ts` tem `import 'server-only'`: se ele realmente entrasse no
 * bundle do cliente, o próprio Next reprovaria o build com uma mensagem
 * melhor que esta. Ele aparece aqui porque o fechamento textual não enxerga a
 * poda que o bundler faz — é sobre-aproximação, não defeito.
 */
const DE_OUTRA_REDE = ['packages/core/src/config/app.ts']

/**
 * O módulo de registro, pelo CAMINHO — não por expressão regular.
 *
 * O padrão anterior era `['"](@venn/core/marca|\.{1,2}/+marca)['"]`, e ele
 * deixava passar `'../../marca'`: depois de `..` e da barra vinha outro `..`,
 * não `marca`. Ou seja, **o caso direto que a regra 6 existe para pegar — um
 * `'use client'` importando o registro — escapava se o arquivo estivesse dois
 * níveis abaixo**, que é onde mora metade dos componentes
 * (`components/<pasta>/X.tsx`). Descoberto ao provar a regra no sentido de
 * falhar, em 15/11/2026.
 *
 * Agora o critério é o mesmo do bundler: resolve o especificador e compara com
 * o arquivo. Nada para manter em sincronia com a árvore de pastas.
 */
const CAMINHO_DO_REGISTRO = 'packages/core/src/marca.ts'

const codigo = arquivosDeCodigo()
const noRepo = new Set(codigo)
const texto = new Map(codigo.map((f) => [f, readFileSync(f, 'utf8')]))

if (!noRepo.has(CAMINHO_DO_REGISTRO)) {
    // Caminho literal tem de falhar ALTO quando o arquivo se move: calado, esta
    // regra passaria a aprovar tudo. É a sexta forma do defeito de caminho
    // literal desta fase, e a única rede contra ela é a recusa em rodar.
    console.error(`✖ ${CAMINHO_DO_REGISTRO} não existe — o registro da marca mudou de lugar.`)
    console.error('  Atualize CAMINHO_DO_REGISTRO em scripts/check-marca.mjs: sem isso a regra 6')
    console.error('  não acusaria mais nada, em silêncio.')
    process.exit(2)
}

const sementes = codigo.filter((f) => /^['"]use client['"]/m.test(texto.get(f).slice(0, 200)))
exigirPiso('componentes de cliente', sementes, 150)
conferirAllowlist('marca no cliente', DO_CONTEXTO, codigo)
conferirAllowlist('dono em outra rede', DE_OUTRA_REDE, codigo)

/**
 * Só import de VALOR entra no fechamento.
 *
 * `import type { X } from './y'` é apagado na compilação e não põe `y` no
 * bundle — contá-lo encheria a lista de falsos positivos (metade dos
 * componentes importa o TIPO `Vocabulario`). Um `{ type A, type B }` todo de
 * tipo também sai.
 */
function especificadoresDeValor(t) {
    const fora = []
    /**
     * A cláusula pode atravessar LINHAS, e por muito tempo não podia.
     *
     * O padrão era `[^'"\n;]*?`, com `\n` na classe negada — então um import
     * de várias linhas, que é como se escreve qualquer import de três nomes,
     * **não casava e o módulo nunca entrava no fechamento**:
     *
     *     import {
     *         PEDIDOS_DE_TEXTO,
     *         ROTULO_DO_PEDIDO,
     *     } from '@venn/core/lib/propostas/ia'
     *
     * Medido em 21/11/2026: com aquele padrão, a regra 7 passava num arquivo
     * que o `next build` reprovava — e a regra 6, a da marca, tinha o mesmo
     * furo. É o terceiro defeito de padrão deste verificador descoberto ao
     * provar uma regra **no sentido de falhar**, e os três eram do mesmo tipo:
     * a expressão aprovava por não alcançar.
     *
     * As aspas e o `;` seguem fora da classe: eles é que impedem a cláusula de
     * atravessar um import inteiro até o `from` do seguinte.
     */
    for (const m of t.matchAll(/(?:^|\n)\s*(?:import|export)\s+([^'";]*?)from\s*['"]([^'"]+)['"]/g)) {
        const clausula = m[1]
        if (/^\s*type\s/.test(clausula)) continue
        const chaves = clausula.match(/\{([^}]*)\}/)
        if (chaves && chaves[1].split(',').every((n) => n.trim() === '' || /^type\s/.test(n.trim()))) continue
        fora.push(m[2])
    }
    for (const m of t.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) fora.push(m[1])
    return fora
}

/** O caminho do repositório para um especificador, ou null se for externo. */
function resolverEspecificador(spec, deQuem) {
    let base
    if (spec.startsWith('.')) {
        base = join(deQuem, '..', spec)
    } else if (spec.startsWith('@venn/')) {
        const [, pkg, ...resto] = spec.split('/')
        base =
            pkg === 'core' && (resto[0] === 'rotas' || resto[0] === 'rotas-jsx')
                ? join('packages/core/src/rotas', ...resto.slice(1))
                : join(`packages/${pkg}/src`, ...resto)
    } else {
        return null
    }
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (noRepo.has(c)) return c
    }
    return null
}

const fechamento = new Set(sementes)
const porQuem = new Map()
const fila = [...sementes]
while (fila.length) {
    const f = fila.pop()
    for (const spec of especificadoresDeValor(texto.get(f) ?? '')) {
        const alvo = resolverEspecificador(spec, f)
        if (!alvo || fechamento.has(alvo)) continue
        fechamento.add(alvo)
        porQuem.set(alvo, f)
        fila.push(alvo)
    }
}
exigirPiso('módulos no bundle do cliente', [...fechamento], 250)

for (const f of fechamento) {
    if (DO_CONTEXTO.includes(f) || DE_OUTRA_REDE.includes(f)) continue
    const leORegistro = especificadoresDeValor(texto.get(f) ?? '').some(
        (spec) => resolverEspecificador(spec, f) === CAMINHO_DO_REGISTRO
    )
    if (!leORegistro) continue
    const comoChegou = sementes.includes(f) ? "é 'use client'" : `é alcançado por "${porQuem.get(f)}"`
    erro(`"${f}" ${comoChegou} e importa o registro da marca.`)
    console.error('  No navegador ninguém registrou a marca: a leitura lança na tela, depois de')
    console.error('  o build passar e a publicação ter sido aceita. Receba o valor por parâmetro')
    console.error('  (o chamador tira de `useMarca()`/`useVocab()`) em vez de ler o registro aqui.')
}

// ── 7. nada no bundle do cliente é `server-only` ────────────────────────
//
// A regra 6 pega o registro da marca; esta pega a classe inteira de que ele é
// um caso. O fechamento já está calculado acima — é o mesmo critério do
// bundler —, então custa uma passada a mais e nada de infraestrutura.
//
// **Por que não basta deixar para o Next.** Ele pega, e o comentário de
// `DE_OUTRA_REDE` acima dizia que a mensagem dele seria melhor que esta. Medido
// em 21/11/2026: não é. Quando `PropostaClient.tsx` ('use client') importou
// dois valores de `lib/propostas/ia.ts` (`server-only`, carrega Prisma), o
// `next build` reprovou com
//
//     Module not found: Can't resolve 'pg'
//
// e um "import trace" de onze linhas terminando em `pg/lib/stream.js`. A causa
// — um módulo de servidor alcançado pelo cliente — não aparece na mensagem; o
// que aparece é o driver de Postgres, que ninguém pôs ali. E aparece depois de
// **quatro minutos** de build no CI, três vezes em paralelo.
//
// Aqui aparece em dois segundos, dizendo qual arquivo e por quem foi alcançado.
const DE_SERVIDOR_TOLERADO = [
    /**
     * `config/app.ts` é a sobre-aproximação que o comentário de
     * `DE_OUTRA_REDE` já descrevia: o fechamento textual não enxerga a poda que
     * o bundler faz. Mantido pela mesma razão, e no mesmo espírito — a isenção
     * é por decisão, não por acidente do padrão.
     */
    'packages/core/src/config/app.ts',
]
conferirAllowlist('servidor tolerado no cliente', DE_SERVIDOR_TOLERADO, codigo)

for (const f of fechamento) {
    if (DE_SERVIDOR_TOLERADO.includes(f)) continue
    // A diretiva vale no topo do arquivo, como `'use client'`.
    if (!/^import ['"]server-only['"]/m.test((texto.get(f) ?? '').slice(0, 400))) continue
    const comoChegou = sementes.includes(f) ? "é 'use client'" : `é alcançado por "${porQuem.get(f)}"`
    erro(`"${f}" ${comoChegou} e é \`server-only\`.`)
    console.error('  Um módulo de servidor no bundle do cliente arrasta com ele o que ele importa —')
    console.error('  Prisma, driver de banco, credencial. O `next build` reprova, mas acusando o')
    console.error('  pacote do fim da cadeia (`Can\'t resolve \'pg\'`) e só depois de minutos.')
    console.error('  Mova o VALOR que a tela precisa para um módulo neutro, e importe-o dos dois')
    console.error('  lados — ver `lib/propostas/pedidos.ts` e `lib/propostas/validade.ts`.')
}

if (falhas > 0) {
    console.error(`\n${falhas} problema(s) no registro da marca.`)
    process.exit(1)
}
console.log(
    `registro da marca: ${appsDoRepo().length} app(s), ${ENTRADAS.filter((e) => e.existe).length} ponto(s) de entrada em ordem, ` +
    `${dosPacotes.length} arquivo(s) de pacote sem importar nada do app pelo alias, ` +
    `${sementes.length} semente(s) de cliente e ${fechamento.size} módulo(s) no bundle sem chamar o registro`
)
