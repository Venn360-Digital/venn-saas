/**
 * Apaga os tipos que o Next GERA, antes de qualquer typecheck.
 *
 *     node scripts/limpar-tipos-gerados.mjs
 *
 * ## O defeito que isto existe para evitar
 *
 * O `tsconfig.json` de cada app inclui `.next/types/**` e `.next/dev/types/**`
 * de propósito: é lá que o Next emite o validador de rotas, e ele pega
 * assinatura errada de `page.tsx` e de route handler. Mas são arquivos
 * **gerados**, e quem os gera não é mais um só:
 *
 * - `next build` e `next dev` emitem `routes.d.ts` **e** `validator.ts`;
 * - o `vite build` do vinext — que é o build que de fato publicamos — emite um
 *   `routes.d.ts` com outra forma, e não emite `validator.ts`.
 *
 * Medido em 2026-11-11 num worktree: um `validator.ts` de 09/11 (de um
 * `next dev`) importava `AppRoutes`, `LayoutRoutes`, `ParamMap` e
 * `AppRouteHandlerRoutes` de `./routes.js`; o `vite build` daquela manhã
 * regravou `routes.d.ts` com **um** export, nenhum deles. `tsc --noEmit` passou
 * a falhar em quatro linhas, e nenhuma delas era código nosso.
 *
 * Isso é veneno num portão de deploy. O typecheck do `preportao:*` roda
 * **depois** do build (o deploy command vem depois do build command), então
 * ele herda o que o vinext escreveu ali — e reprovaria o deploy por lixo de
 * geração, com uma mensagem que manda procurar defeito onde não há.
 *
 * ## Por que apagar, e não excluir do tsconfig
 *
 * Excluir mataria a verificação de rotas também no caminho onde ela funciona
 * (`npm run build`, que é `next build` e regenera os dois arquivos coerentes
 * logo depois deste script). Apagar mantém a cobertura onde ela é válida e tira
 * o estado inconsistente onde não é: o que o Next precisar, ele gera de novo; o
 * que ficou órfão, não volta.
 *
 * ## O conserto de 26/11/2026: ele não apagava nada, e dizia que apagou
 *
 * A versão anterior chamava `rmSync('.next/types')` — **relativo ao diretório
 * de trabalho**. Num monorepo o `.next` não mora na raiz: mora em
 * `apps/<app>/.next`, porque é o `tsconfig.json` de cada app que o inclui. Com
 * `force: true` o ENOENT era engolido, e a última linha imprimia "tipos gerados
 * limpos" sem ter tocado em arquivo nenhum.
 *
 * O custo foi concreto: `pnpm run verificar` começa por este script, então o
 * portão **parecia** limpar e não limpava. Em 26/11/2026 um
 * `apps/odontobox360/.next/types/validator.ts` datado de cinco dias antes
 * sobreviveu a uma execução e fez o typecheck reprovar com 24 erros `TS2307`
 * apontando para rotas de **outro branch** — nenhuma delas em arquivo alterado.
 *
 * Duas mudanças fecham a classe inteira do defeito, não só o caso:
 *
 * 1. **A raiz vem do próprio arquivo**, por `import.meta.url`, e não do
 *    diretório de trabalho. Rodar de outra pasta deixou de mudar o resultado.
 * 2. **O relatório diz o que foi apagado**, não a lista do que se tentou. Era a
 *    mensagem otimista que escondia o defeito: um script de limpeza que afirma
 *    sucesso sem evidência não é observável, e este ficou quebrado por dias sem
 *    ninguém notar.
 *
 * Varre a raiz do repositório e **todo pacote do workspace** (`packages/*` e
 * `apps/*`, lidos do `pnpm-workspace.yaml` em vez de escritos à mão): app novo
 * entra na varredura sem ninguém lembrar de incluí-lo.
 *
 * Nunca falha. Diretório que não existe é o caso normal — num checkout limpo do
 * CI não há `.next` nenhum, e aí a mensagem diz exatamente isso.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A raiz do repositório, deduzida deste arquivo: `scripts/` fica nela.
 *
 * **Não é `process.cwd()`, e essa é a correção.** O caminho relativo ao
 * diretório de trabalho foi exatamente o que fez a versão anterior varrer o
 * lugar errado em silêncio.
 */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Os dois diretórios gerados, relativos a cada pacote. */
const GERADOS = ['.next/types', '.next/dev/types']

/**
 * Onde procurar: a raiz e cada pacote do workspace.
 *
 * Os globos saem do `pnpm-workspace.yaml` para que app novo entre sozinho. O
 * formato aceito é o que o arquivo usa hoje — `- 'prefixo/*'` —, e qualquer
 * outra coisa é ignorada em vez de quebrar: este script limpa, não valida
 * configuração de workspace.
 */
function pacotesDoWorkspace() {
    const bases = [RAIZ]

    let globos = []
    try {
        const yaml = readFileSync(join(RAIZ, 'pnpm-workspace.yaml'), 'utf8')
        globos = [...yaml.matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => m[1])
    } catch {
        // Sem o arquivo, a convenção do repositório. Não é motivo para falhar.
        globos = ['packages/*', 'apps/*']
    }

    for (const glob of globos) {
        if (!glob.endsWith('/*')) continue
        const pasta = join(RAIZ, glob.slice(0, -2))
        try {
            for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
                if (entrada.isDirectory()) bases.push(join(pasta, entrada.name))
            }
        } catch {
            // Pasta que não existe não é erro: nem todo repositório tem as duas.
        }
    }

    return bases
}

const apagados = []

for (const base of pacotesDoWorkspace()) {
    for (const gerado of GERADOS) {
        const caminho = join(base, gerado)
        // `existsSync` antes de `rmSync` só para **saber** se havia algo. O
        // `force` continua engolindo a corrida entre as duas chamadas.
        if (!existsSync(caminho)) continue
        rmSync(caminho, { recursive: true, force: true })
        apagados.push(relative(RAIZ, caminho) || caminho)
    }
}

console.log(
    apagados.length === 0
        ? 'tipos gerados: nada a apagar'
        : `tipos gerados limpos (${apagados.length}): ${apagados.join(', ')}`
)
