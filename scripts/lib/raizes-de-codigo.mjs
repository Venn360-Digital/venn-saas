/**
 * Onde o código deste repositório mora — derivado, nunca fixo em `'src'`.
 *
 * ## Por que existe
 *
 * Os linters estáticos nasceram num repositório de um app só, e todos
 * começavam igual: `const SRC = join(ROOT, 'src')`. No monorepo o código passa
 * a morar em três lugares (`src/` durante a transição, `packages/<pacote>/src`,
 * `apps/<app>/src`), e uma raiz fixa não erra ruidosamente — ela **passa**.
 *
 * O caso que motivou isto, medido em 14/11/2026: `lint-workspace.mjs` é a rede
 * que garante que nenhuma rota resolve o workspace por conta própria — a
 * fronteira de isolamento multi-tenant, que ficou sendo a única depois da
 * remoção da RLS. Varrendo `src/` fixo, no dia em que `src/app` e `src/lib`
 * forem para `packages/core` ele varre uma árvore sem rotas, imprime
 * "Nenhuma rota resolve o workspace por conta própria" e **aprova** — dizendo
 * a verdade sobre o nada.
 *
 * No mesmo dia um defeito irmão custou três builds: o lint de migração tratou
 * 71 migrações movidas como novas, porque o pathspec do `git diff` esconde um
 * lado do rename. A diferença é que aquele **gritou**. Este se calaria.
 *
 * ## As três travas
 *
 * 1. `raizesDeCodigo()` / `arquivosDeCodigo()` — a varredura acompanha o
 *    código para onde ele for, sem ninguém se lembrar de editar o script.
 * 2. `exigirPiso()` — a contagem de arquivos varridos é impressa e comparada a
 *    um piso declarado. Verde com a contagem no chão deixa de ser possível.
 * 3. `conferirAllowlist()` — prefixo de isenção que não casa com arquivo
 *    nenhum é erro. É o que transforma "a allowlist ficou órfã depois do
 *    `git mv`" de surpresa futura em falha imediata, no commit que move.
 *
 * O piso não é a contagem de hoje: é um mínimo plausível, bem abaixo dela.
 * Serve para pegar colapso (zero, ou uma ordem de grandeza a menos), não a
 * variação normal de um projeto que cresce e encolhe — piso justo demais vira
 * ruído a cada PR, e ruído se aprende a ignorar.
 */
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** Nunca varridas: código gerado, dependências e saídas de build. */
const IGNORADAS = new Set([
    // Cliente do Prisma. Megabytes de código gerado que não chama nada nosso,
    // e que mudou de `src/generated/` para `packages/db/src/generated/` na
    // Fase 2 — motivo de o nome ser comparado, e não o caminho.
    'generated',
    'node_modules',
    '.next',
    '.cloudflare',
    'dist',
    // Cópias inteiras do repositório que as worktrees do Claude deixam aqui
    // dentro. Sem esta linha um linter conta o mesmo arquivo três vezes, e o
    // piso de contagem passa a mentir para cima.
    '.claude',
])

/**
 * As raízes de código que de fato existem, em caminho relativo ao ROOT.
 *
 * `src` continua na lista de propósito: durante a Fase 2 o código vive nos
 * dois lugares, e um linter que só olhasse `packages/` ficaria cego justamente
 * durante a transição, que é quando ele é mais necessário.
 */
export function raizesDeCodigo() {
    const achadas = []
    if (existsSync(join(ROOT, 'src'))) achadas.push('src')
    for (const grupo of ['packages', 'apps']) {
        const base = join(ROOT, grupo)
        if (!existsSync(base)) continue
        for (const pacote of readdirSync(base).sort()) {
            if (IGNORADAS.has(pacote) || pacote.startsWith('_')) continue
            const src = join(base, pacote, 'src')
            if (existsSync(src)) achadas.push(`${grupo}/${pacote}/src`)
        }
    }
    return achadas
}

function descer(dir, saida) {
    for (const nome of readdirSync(dir)) {
        if (IGNORADAS.has(nome)) continue
        const caminho = join(dir, nome)
        if (statSync(caminho).isDirectory()) descer(caminho, saida)
        else if (/\.(ts|tsx|mts|cts)$/.test(nome)) saida.push(relative(ROOT, caminho))
    }
    return saida
}

/**
 * Todo arquivo de código, em caminho relativo ao ROOT e com barra normal.
 *
 * `subcaminhos` restringe a varredura a certas pastas DENTRO de cada raiz —
 * é como `lint-fuso` pede só o lado servidor (`app/api`, `trabalhos`, `lib`,
 * `cloudflare`) sem precisar saber em que pacote cada um foi parar.
 */
export function arquivosDeCodigo(subcaminhos = null) {
    const saida = []
    for (const raiz of raizesDeCodigo()) {
        const alvos = subcaminhos
            ? subcaminhos.map((s) => join(ROOT, raiz, s)).filter((d) => existsSync(d))
            : [join(ROOT, raiz)]
        for (const alvo of alvos) descer(alvo, saida)
    }
    return saida.map((p) => p.split('\\').join('/'))
}

/**
 * Imprime quantos arquivos foram varridos e reprova se a contagem desabou.
 *
 * Esta é a trava contra o falso verde: sem ela, "0 problemas" sobre 0 arquivos
 * é indistinguível de "0 problemas" sobre 842.
 */
export function exigirPiso(nome, arquivos, piso) {
    console.log(`${nome}: ${arquivos.length} arquivo(s) varrido(s) em ${raizesDeCodigo().join(', ')}`)
    if (arquivos.length < piso) {
        console.error(
            `\n✖ ${nome} varreu ${arquivos.length} arquivo(s), abaixo do piso de ${piso}.\n` +
            'Isto não é "nada a verificar": é a varredura tendo perdido o código.\n' +
            'Causa provável: um `git mv` levou a pasta para um lugar que as raízes\n' +
            'derivadas não alcançam, ou o piso ficou desatualizado depois de uma\n' +
            'divisão legítima. Confira `raizesDeCodigo()` antes de baixar o piso.\n'
        )
        process.exit(1)
    }
}

/**
 * Prefixo de isenção que não casa com arquivo nenhum é erro, não detalhe.
 *
 * Uma allowlist órfã é silenciosa duas vezes: deixa de isentar o arquivo que
 * devia (que passa a reprovar sem motivo aparente, longe de quem o moveu) e
 * esconde que o caminho mudou. Falhar aqui põe o erro no commit que move.
 */
export function conferirAllowlist(nome, prefixos, arquivos) {
    const orfaos = prefixos.filter((p) => !arquivos.some((f) => f.startsWith(p)))
    if (orfaos.length === 0) return
    console.error(`\n✖ ${nome}: ${orfaos.length} isenção(ões) não casa(m) com nenhum arquivo varrido:`)
    for (const o of orfaos) console.error(`    ${o}`)
    console.error(
        '\nO caminho isentado mudou de lugar (ou deixou de existir). Atualize a\n' +
        'lista no mesmo commit que move o arquivo — é o único momento em que\n' +
        'alguém sabe para onde ele foi.\n'
    )
    process.exit(1)
}

/**
 * O caminho de um arquivo de código, procurado em vez de escrito.
 *
 * Existe porque os verificadores não leem só imports: vários abrem o
 * FONTE de um módulo com `readFileSync` para conferir um fato sobre ele — que
 * a fila tem processador, que o cron está no mapa de despacho, que o serviço
 * de conversa não dispara funil. Esses caminhos eram literais (`'src/trabalhos/
 * processadores/cron/index.ts'`), e o `git mv` da Fase 2 os deixou apontando
 * para o nada: `check-trabalhos` morreu com ENOENT depois de 20 PASS, e
 * `check-paridade` — que trata ausência devolvendo string vazia — passaria a
 * avaliar o vazio, calado.
 *
 * Era a QUARTA forma do mesmo defeito no mesmo dia (pathspec do `git diff`,
 * raiz fixa dos linters, `exclude` do tsconfig, e agora caminho de
 * `readFileSync`). O padrão: **caminho literal em ferramenta não sobrevive a
 * `git mv`, e quase nunca falha dizendo isso.**
 *
 * Recebe o SUFIXO estável do caminho — `trabalhos/processadores/cron/index.ts`
 * — e procura nas raízes. Lança se não achar ou se achar mais de um: as duas
 * situações significam que o verificador deixou de saber do que fala, e
 * nenhuma delas pode passar como sucesso.
 */
export function resolverNoCodigo(sufixo) {
    const achados = arquivosDeCodigo().filter((f) => f.endsWith(sufixo))
    if (achados.length === 1) return achados[0]
    if (achados.length === 0) {
        throw new Error(
            `não achei nenhum arquivo terminando em "${sufixo}" em ${raizesDeCodigo().join(', ')}.\n` +
            'Se ele mudou de lugar, o sufixo é o que precisa ser atualizado — e se ele\n' +
            'deixou de existir, a verificação que o lê precisa sair junto.'
        )
    }
    throw new Error(
        `"${sufixo}" casa com ${achados.length} arquivos: ${achados.join(', ')}.\n` +
        'Ambíguo: use um sufixo mais longo, que diga qual deles interessa.'
    )
}
