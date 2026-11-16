/**
 * Os wrappers de rota de cada app, gerados a partir do core.
 *
 * ## Por que wrappers, e não o app dir no core
 *
 * O App Router do Next descobre rota por CAMINHO DE ARQUIVO dentro de
 * `app/`, e nem o Next nem o vinext aceitam um app dir fora do projeto.
 * Symlink quebra no builder. Então o conteúdo mora uma vez em
 * `packages/core/src/rotas/**` e cada app carrega uma casca de uma a três
 * linhas por rota, gerada e COMMITADA — commitada porque o builder não roda
 * geradores antes do `vite build`, e porque um wrapper no diff é um wrapper
 * que alguém pode ler.
 *
 * ## O que é re-exportado e o que é INLINADO, e por quê
 *
 * `dynamic` e `runtime` são lidos pelo SWC em tempo de build, por análise
 * estática do módulo de rota — ele não atravessa um `export … from`. Um
 * `runtime = 'nodejs'` re-exportado seria simplesmente ignorado, e a rota
 * passaria a rodar no runtime errado **sem erro nenhum**: compila, builda,
 * publica. Por isso o gerador copia o literal para dentro do wrapper.
 *
 * Medido no odontobox antes de escrever isto: 18 configs em 16 arquivos, só
 * `dynamic` e `runtime`. Nenhum `revalidate`, `maxDuration`, `fetchCache` ou
 * `preferredRegion` — mas a lista aceita todos, porque o custo é uma linha e
 * o primeiro `revalidate` da vida seria descoberto em produção.
 *
 * O resto (`default`, `metadata`, `generateMetadata`, os verbos HTTP) o Next
 * lê como export do módulo, em runtime, e re-exportar basta.
 *
 * ## Export desconhecido é ERRO, nunca omissão
 *
 * Um gerador que ignora o que não entende produz casca incompleta em
 * silêncio. A medição mostrou dois casos que um gerador ingênuo erraria, e o
 * primeiro é grave:
 *
 *   `api/auth/[...all]/route.ts` → `export const { GET, POST } = toNextJsHandler(auth)`
 *
 * Desestruturação não casa `export const NOME`. O wrapper sairia sem os dois
 * verbos e o login inteiro cairia — com build verde. Daí o reconhecimento
 * explícito dessa forma, e o erro para qualquer export fora do vocabulário.
 *
 * Tipo exportado de arquivo de rota também é erro: o app importa o wrapper,
 * não o fonte, então o tipo ficaria inalcançável. Ele pertence a um módulo do
 * core fora da árvore de rotas.
 *
 * ## `--check`
 *
 * No portão, compara disco com o que seria gerado e reprova a diferença. É o
 * que impede alguém de editar a casca em vez do conteúdo, e o que cobra o
 * `pnpm gerar:rotas` depois de uma rota nova.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const RAIZ_DO_CORE = 'packages/core/src/rotas'
const MARCADOR = 'GERADO por scripts/gerar-rotas.ts'

/**
 * As convenções do App Router que viram wrapper, e o que cada uma pode
 * exportar. Arquivo que não esteja aqui (um `dados.ts`, um `*Client.tsx`) é
 * colocação: mora no core e é importado de lá pelo conteúdo, sem casca.
 */
const CONVENCOES: Record<string, string[]> = {
    'page.tsx': ['default', 'metadata', 'generateMetadata', 'generateStaticParams', 'viewport', 'generateViewport'],
    'route.ts': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    'layout.tsx': ['default', 'metadata', 'generateMetadata', 'viewport', 'generateViewport'],
    'template.tsx': ['default'],
    'loading.tsx': ['default'],
    'error.tsx': ['default'],
    'global-error.tsx': ['default'],
    'not-found.tsx': ['default', 'metadata', 'generateMetadata'],
    'default.tsx': ['default'],
    'forbidden.tsx': ['default'],
    'unauthorized.tsx': ['default'],
}

/** Lidos por análise estática: têm de ser copiados, não re-exportados. */
const CONFIGS = [
    'dynamic', 'dynamicParams', 'revalidate', 'fetchCache',
    'runtime', 'preferredRegion', 'maxDuration', 'experimental_ppr',
]

type Rota = {
    /** Caminho relativo a `RAIZ_DO_CORE`, ex.: `(dashboard)/vendas/page.tsx`. */
    rel: string
    convencao: string
    reexportar: string[]
    /** `[nome, literal]` — copiados para dentro do wrapper. */
    inlinar: [string, string][]
    /**
     * A fonte declara `'use client'`? Então a casca também precisa declarar.
     *
     * Diretiva NÃO atravessa um `export … from` — é a mesma razão dos configs
     * acima, e pelo mesmo mecanismo: o compilador a lê do ARQUIVO, por análise
     * estática, antes de resolver import nenhum.
     *
     * Descoberto em 16/11/2026 por um build que rodou `next build` (o alvo Node,
     * que o deploy não usa) com o comando errado depois da troca de dono do
     * repositório:
     *
     *     apps/odontobox360/src/app/global-error.tsx must be a Client Component.
     *     > export { default } from '@venn/core/rotas-jsx/global-error'
     *
     * `error.tsx` e `global-error.tsx` são os casos em que o Next EXIGE a
     * diretiva no próprio arquivo. Mas a regra aqui é uniforme — copia sempre
     * que a fonte tiver —, e de propósito: condicionar a um nome de arquivo
     * seria mais um critério textual para manter em sincronia com o framework,
     * que é a forma de defeito que mais apareceu nesta fase.
     *
     * Para as páginas de cliente o efeito é nulo (a fronteira já estava um nível
     * abaixo, no arquivo do core, e a casca não tem outro código); para as duas
     * de erro, é o que faz o `next build` compilar.
     */
    cliente: boolean
}

const problemas: string[] = []
function erro(msg: string, detalhe?: string) {
    problemas.push(msg)
    console.error(`✖ ${msg}`)
    if (detalhe) console.error(`  ${detalhe}`)
}

function arquivos(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n)
        return statSync(p).isDirectory() ? arquivos(p) : [p]
    })
}

/**
 * Os exports do módulo, classificados. Reconhece as formas que a medição
 * encontrou — e devolve o que não reconheceu, para virar erro em vez de
 * silêncio.
 */
function classificar(rel: string, texto: string, permitidos: string[]): Rota | null {
    /*
     * A diretiva tem de ser a PRIMEIRA instrução do arquivo — por isso a busca é
     * ancorada no início, tolerando apenas espaço em branco antes. Procurar em
     * qualquer lugar casaria a menção dela dentro de um comentário.
     */
    const cliente = /^\s*['"]use client['"]/.test(texto)
    const achados: { nome: string; valor?: string; tipo?: boolean }[] = []

    for (const m of texto.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
        achados.push({ nome: m[1] })
    }
    if (/^export\s+default\s/m.test(texto)) achados.push({ nome: 'default' })
    for (const m of texto.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=\s*(.*)$/gm)) {
        achados.push({ nome: m[1], valor: m[2].trim() })
    }
    // `export const { GET, POST } = …` — a forma da rota de autenticação.
    for (const m of texto.matchAll(/^export\s+const\s*\{([^}]*)\}\s*(?::[^=]*?)?=/gm)) {
        for (const parte of m[1].split(',')) {
            const nome = parte.split(':')[0].trim()
            if (nome) achados.push({ nome })
        }
    }
    for (const m of texto.matchAll(/^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm)) {
        achados.push({ nome: m[1], tipo: true })
    }
    for (const m of texto.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const parte of m[1].split(',')) {
            const nome = parte.split(/\s+as\s+/).pop()!.trim()
            if (nome && nome !== 'type') achados.push({ nome })
        }
    }
    if (/^export\s*\*/m.test(texto)) {
        erro(`"${rel}" usa \`export *\`.`, 'O gerador não sabe o que a estrela traz; nomeie os exports.')
        return null
    }

    const reexportar: string[] = []
    const inlinar: [string, string][] = []
    for (const { nome, valor, tipo } of achados) {
        if (tipo) {
            erro(`"${rel}" exporta o tipo \`${nome}\`.`,
                'O app importa o wrapper, não o fonte — o tipo ficaria inalcançável. ' +
                'Ele pertence a um módulo do core fora de `rotas/`.')
            continue
        }
        if (CONFIGS.includes(nome)) {
            if (!valor || !/^(['"`]).*\1$|^\d+$|^(true|false)$/.test(valor.replace(/\s*(\/\/.*)?$/, ''))) {
                erro(`"${rel}": o config \`${nome}\` não é um literal numa linha.`,
                    `Valor lido: ${valor ?? '(nenhum)'} — o gerador tem de COPIÁ-LO, e só copia literal.`)
                continue
            }
            inlinar.push([nome, valor.replace(/\s*(\/\/.*)?$/, '')])
            continue
        }
        if (permitidos.includes(nome)) {
            if (!reexportar.includes(nome)) reexportar.push(nome)
            continue
        }
        erro(`"${rel}" exporta \`${nome}\`, que não é convenção do App Router aqui.`,
            `Esta convenção aceita: ${permitidos.join(', ')}. Helper exportado de rota não chega ao app.`)
    }
    if (!reexportar.length && !inlinar.length) {
        erro(`"${rel}" não exporta nada que o Next use.`)
        return null
    }
    return { rel, convencao: rel.split('/').pop()!, reexportar, inlinar, cliente }
}

/**
 * O especificador do import, por extensão — e NÃO por array de fallback.
 *
 * As rotas misturam handlers `.ts` e páginas `.tsx` na mesma árvore, e um
 * subpath pattern mapeia uma extensão só. A primeira saída foi o array
 * `["./src/rotas/*.ts", "./src/rotas/*.tsx"]`, que os dois typechecks
 * resolvem certo (provado com `--traceResolution`) — e que **o rolldown não
 * resolve**:
 *
 *   Rolldown failed to resolve import "@venn/core/rotas/error"
 *
 * Eu havia declarado isso provado por um build de preview verde, e o build não
 * provava nada: o ensaio morava em `rotas/_prova/**`, e no App Router **pasta
 * que começa com `_` é privada** — o Next a exclui do roteamento. Os quatro
 * arquivos de prova nunca entraram no grafo, nenhum import foi resolvido, e o
 * verde era sobre o nada. Usei o prefixo `_` justamente para o ensaio não
 * criar rota pública, e com isso desliguei o próprio teste.
 *
 * Então: dois subpaths explícitos, escolhidos pela extensão que este gerador
 * já conhece. Determinístico, sem depender de como um resolvedor trata array.
 */
function especificador(rel: string): string {
    const semExt = rel.replace(/\.tsx?$/, '')
    const familia = rel.endsWith('.tsx') ? 'rotas-jsx' : 'rotas'
    return `@venn/core/${familia}/${semExt}`
}

function wrapper(r: Rota): string {
    const linhas: string[] = []
    if (r.cliente) {
        // Primeira linha do arquivo: comentário antes é permitido, instrução não.
        linhas.push("'use client'", '')
    }
    linhas.push(
        `/* ${MARCADOR} — não edite.`,
        ` * Conteúdo: packages/core/src/rotas/${r.rel}`,
    )
    if (r.inlinar.length) {
        linhas.push(
            ' *',
            ' * Os configs abaixo são COPIADOS, não re-exportados: o SWC os lê por análise',
            ' * estática e não atravessa um `export … from`. Re-exportados, seriam ignorados',
            ' * em silêncio e a rota rodaria no modo errado.',
        )
    }
    if (r.cliente) {
        linhas.push(
            ' *',
            " * A diretiva `'use client'` acima é copiada pela MESMA razão, e não é",
            ' * decoração: sem ela o Next recusa `error.tsx` e `global-error.tsx`, que',
            ' * ele exige que sejam componentes de cliente.',
        )
    }
    linhas.push(' */')
    // `default` primeiro quando existe — e SÓ quando existe: um
    // `export { default } from` num `route.ts`, que não tem default, é erro.
    const ordem = r.reexportar.includes('default')
        ? ['default', ...r.reexportar.filter((n) => n !== 'default')]
        : r.reexportar
    if (ordem.length) linhas.push(`export { ${ordem.join(', ')} } from '${especificador(r.rel)}'`)
    for (const [nome, valor] of r.inlinar) linhas.push(`export const ${nome} = ${valor}`)
    return linhas.join('\n') + '\n'
}

function appsDoRepo(): string[] {
    return readdirSync('apps')
        .filter((n) => existsSync(join('apps', n, 'src', 'app')))
        .map((n) => join('apps', n))
}

function overrides(app: string): { excluir: string[] } {
    const p = join(app, 'rotas.overrides.json')
    if (!existsSync(p)) return { excluir: [] }
    const lido = JSON.parse(readFileSync(p, 'utf8')) as { excluir?: string[] }
    return { excluir: lido.excluir ?? [] }
}

// ── execução ─────────────────────────────────────────────────────────────
const conferir = process.argv.includes('--check')

const rotas: Rota[] = []
for (const caminho of arquivos(RAIZ_DO_CORE)) {
    const rel = relative(RAIZ_DO_CORE, caminho)
    const nome = rel.split('/').pop()!
    const permitidos = CONVENCOES[nome]
    if (!permitidos) continue // colocação: vive no core, sem casca
    const r = classificar(rel, readFileSync(caminho, 'utf8'), permitidos)
    if (r) rotas.push(r)
}

if (!rotas.length) {
    erro('nenhuma rota encontrada em ' + RAIZ_DO_CORE,
        'Varredura vazia reporta sucesso se ninguém cobrar — este piso existe para ' +
        'que ela reprove. Se as rotas mudaram de lugar, é RAIZ_DO_CORE que muda.')
}

let escritos = 0
let divergentes = 0
for (const app of appsDoRepo()) {
    const { excluir } = overrides(app)
    const esperados = new Map<string, string>()
    for (const r of rotas) {
        if (excluir.some((e) => r.rel === e || r.rel.startsWith(e.replace(/\/?$/, '/')))) continue
        esperados.set(join(app, 'src/app', r.rel), wrapper(r))
    }

    for (const [destino, conteudo] of esperados) {
        const atual = existsSync(destino) ? readFileSync(destino, 'utf8') : null
        if (atual === conteudo) continue
        if (atual !== null && !atual.includes(MARCADOR)) {
            erro(`"${destino}" existe e NÃO é gerado, mas o core também tem essa rota.`,
                'Duas fontes para o mesmo caminho. Ou a rota é exclusiva do app (declare-a ' +
                'em `rotas.overrides.json`), ou o arquivo do app é resíduo e sai.')
            continue
        }
        divergentes++
        if (conferir) {
            console.error(`✖ fora de sincronia: ${destino}`)
            continue
        }
        mkdirSync(dirname(destino), { recursive: true })
        writeFileSync(destino, conteudo)
        escritos++
    }

    // Casca órfã: gerada antes, sem conteúdo no core hoje.
    for (const caminho of arquivos(join(app, 'src/app'))) {
        if (esperados.has(caminho)) continue
        if (!/\.tsx?$/.test(caminho)) continue
        if (!readFileSync(caminho, 'utf8').includes(MARCADOR)) continue
        divergentes++
        if (conferir) {
            console.error(`✖ casca órfã (o conteúdo saiu do core): ${caminho}`)
            continue
        }
        rmSync(caminho)
        escritos++
    }
}

if (problemas.length) {
    console.error(`\n${problemas.length} problema(s) — nenhum wrapper foi ${conferir ? 'conferido' : 'escrito'} para eles.`)
    process.exit(1)
}
if (conferir) {
    if (divergentes) {
        console.error(`\n${divergentes} wrapper(s) fora de sincronia. Rode \`pnpm gerar:rotas\` e commite.`)
        process.exit(1)
    }
    console.log(`rotas em sincronia: ${rotas.length} rota(s) × ${appsDoRepo().length} app(s)`)
} else {
    console.log(`rotas geradas: ${rotas.length} rota(s) × ${appsDoRepo().length} app(s), ${escritos} arquivo(s) alterado(s)`)
}
