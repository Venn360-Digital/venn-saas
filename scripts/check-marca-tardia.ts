#!/usr/bin/env tsx
/**
 * Nenhum módulo do core lê a marca na própria avaliação.
 *
 * ## O que isto pega, e como descobri que faltava
 *
 * `check-marca.mjs` garante QUEM registra e em que ORDEM. Não garante QUANDO a
 * marca é lida — e é essa a falha que derrubou o deploy de preview de 14/11:
 *
 *     [10021] Uncaught Error: MarcaNaoRegistradaError
 *       at ./_next/static/marca-*.js in r
 *       at ./_next/static/billing-*.js in c
 *
 * O build compilou inteiro (3min22s) e a Cloudflare reprovou na PUBLICAÇÃO: ela
 * avalia os módulos do Worker para validar o script, e nessa avaliação não
 * houve requisição nenhuma — logo, ninguém havia registrado a marca. Um `const`
 * de nível de módulo que chama `BRAND()` quebra o Worker no startup, e nenhum
 * typecheck, lint ou teste estático vê isso.
 *
 * O fail-fast de `BRAND()` fez o seu trabalho: apareceu no preview, não em
 * produção. O que faltava era uma rede que o fizesse aparecer ANTES do build.
 *
 * ## Como prova
 *
 * Importa cada módulo que lê a marca **sem registrar nada**. Se o import
 * lançar `MarcaNaoRegistradaError`, aquele módulo lê a marca cedo. É a mesma
 * coisa que a Cloudflare faz ao validar o script, dois minutos antes em vez de
 * dois minutos depois.
 *
 * A lista é derivada, não escrita à mão: **todo** arquivo de `packages/core`
 * entra. Assim um módulo novo não escapa por ninguém ter se lembrado de
 * acrescentá-lo.
 *
 * ## Por que TODOS, e não só quem menciona `BRAND(`
 *
 * A primeira versão filtrava por `/\bBRAND\s*\(/` — e deixou passar o deploy
 * seguinte, no MESMO dia. O módulo culpado foi
 * `lib/asaas/referencia.ts`, com `const SLUG = APP().slug`: ele lê a marca de
 * verdade, mas por `APP()`, e nunca escreve `BRAND(`. Ampliar o filtro para
 * `APP(` também só empurraria a lacuna um nível abaixo — `appUrl()`,
 * `plansUrl()` e qualquer helper futuro chamam `APP()` por dentro, e um
 * `const X = appUrl()` não menciona nenhuma das duas.
 *
 * Qualquer filtro textual aqui é uma lista de nomes que alguém tem de manter.
 * Importar tudo não é: é exatamente o que a Cloudflare faz ao validar o
 * script, e por isso não tem como divergir dela.
 *
 * O custo é o tempo dos imports: ~35s, medido em 14/11.
 *
 * ## Duas passadas, porque o Worker tem dois ambientes
 *
 * A primeira versão rodava só com `--conditions=react-server`, e **126 dos 410
 * módulos nem chegavam a ser avaliados**: sob essa condição o `react` resolve
 * para a build de servidor, que não exporta `useState` nem `useLayoutEffect`,
 * então todo componente de cliente estoura no import do React antes de rodar
 * uma linha própria. Eu quase registrei isso como ponto cego aceito; medir a
 * mensagem de erro (`does not provide an export named 'useLayoutEffect'`)
 * mostrou que era uma passada faltando, não um limite.
 *
 * Então são duas, e são complementares — as mesmas duas que o build do vinext
 * produz:
 *
 *   - `servidor` (`--conditions=react-server`): o bundle RSC. Aqui importam os
 *     módulos de servidor; os de cliente caem no React.
 *   - `cliente` (sem a condição): o bundle SSR. Aqui importam os componentes;
 *     os módulos com `import 'server-only'` caem de propósito.
 *
 * Cada passada imprime quantos ignorou e por quê. O que fica sem cobertura é a
 * interseção das duas, não a soma — e um motivo NOVO na lista é o que merece
 * olhar, porque significa um ambiente que nenhuma das duas reproduz.
 *
 * **Interseção medida em 14/11: um módulo.** `cloudflare/motor-do-funil.ts`
 * importa `cloudflare:workers` no topo (precisa do `WorkflowEntrypoint` como
 * classe base), e o loader ESM do Node recusa esse esquema nas duas passadas.
 * Os outros seis módulos do core que tocam `cloudflare:workers` usam import
 * dinâmico e por isso atravessam. Cobertura: 409 de 410.
 *
 * Para cobrir o último faltaria um ambiente workerd, que esta máquina não roda
 * (macOS 12). Fica declarado em vez de escondido; se a interseção crescer, a
 * resposta é olhar o motivo novo, não aumentar o número aceito.
 */
import { arquivosDeCodigo, exigirPiso } from './lib/raizes-de-codigo.mjs'

/** Qual dos dois bundles do Worker esta passada reproduz. Ver o cabeçalho. */
const ambiente = process.argv[2] === 'cliente' ? 'cliente (SSR)' : 'servidor (RSC)'

const candidatos = arquivosDeCodigo()
    .filter((f) => f.startsWith('packages/core/src/'))
    // O registro em si: ele define `BRAND()`, não o consome.
    .filter((f) => !f.endsWith('marca.ts') && !f.endsWith('marca-contexto.tsx'))

exigirPiso(`marca tardia [${ambiente}]`, candidatos, 400)

const eager: string[] = []
const ignorados: string[] = []
for (const f of candidatos) {
    // caminho relativo a este script, para o tsx resolver o módulo real
    const especificador = '../' + f
    try {
        await import(especificador)
    } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        if (msg.includes('MarcaNaoRegistrada')) {
            eager.push(f)
        } else {
            // Outro erro de import (falta de env, `next/*` fora do Next) não é
            // o que se mede aqui: se o módulo tivesse lido a marca cedo, o erro
            // seria o da marca, que acontece antes.
            ignorados.push(`${f} — ${msg.slice(0, 70)}`)
        }
    }
}

console.log(
    `marca tardia [${ambiente}]: ${candidatos.length} módulo(s) avaliados sem marca registrada` +
    (ignorados.length > 0
        ? `, ${ignorados.length} não importável(is) nesta passada`
        : '')
)
if (ignorados.length > 0) {
    // Agrupado: a lista crua de 132 linhas não é lida por ninguém, e o que
    // interessa é se apareceu um motivo NOVO — esse sim merece olhar.
    const porMotivo = new Map<string, number>()
    for (const i of ignorados) {
        const motivo = i.split(' — ')[1]?.split(':')[0] ?? '?'
        porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1)
    }
    for (const [motivo, n] of [...porMotivo].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(n).padStart(4)}× ${motivo}`)
    }
}
if (eager.length > 0) {
    console.error(`\n✖ ${eager.length} módulo(s) leem a marca na AVALIAÇÃO, não no uso:`)
    for (const f of eager) console.error(`    ${f}`)
    console.error(
        '\nIsto quebra o Worker no startup: a Cloudflare avalia os módulos para\n' +
        'validar o script, e ali não há requisição nem marca registrada. Foi assim\n' +
        'que o deploy de preview reprovou em 14/11, depois de o build compilar.\n\n' +
        'Tire a leitura do nível de módulo. As três formas que já usamos:\n' +
        '  · `const X = BRAND().y`           → `const X = () => BRAND().y`\n' +
        '  · objeto com valores interpolados → objeto com `get` (ver CAMINHOS)\n' +
        '  · template string de módulo       → função que a devolve\n'
    )
    process.exit(1)
}
console.log('nenhum deles lê a marca na avaliação do módulo.')
// Explícito de propósito: importar 410 módulos deixa rejeição pendente de
// `next/*` no event loop, e ela derrubava o processo com exit 1 DEPOIS do
// veredicto — passo vermelho sem nada errado. O veredicto já está dado aqui.
process.exit(0)
