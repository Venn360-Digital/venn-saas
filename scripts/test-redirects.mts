/**
 * Provas dos redirecionamentos legados de cada app.
 *
 * ## Por que isto existe
 *
 * Em 15/11/2026 um renomeio em massa de identificador (`especialista` →
 * `profissional`, `procedimento` → `servico`) trocou os `source` do
 * `next.config.ts`:
 *
 *     source: '/vendas/especialistas'  →  source: '/vendas/profissionais'
 *     source: '/vendas/procedimentos'  →  source: '/vendas/servicos'
 *
 * O primeiro apaga o redirecionamento de quem guardou o link antigo; o segundo
 * faz uma rota apontar para si mesma. **Nada pegava**: o typecheck vê duas
 * strings, e não havia teste de rota. Só apareceria em produção, como 404 ou
 * laço — que é exatamente o bug que a Fase 1 consertou nos apps irmãos em
 * 12/11 (menu levando a 308 → 404).
 *
 * Esta é a rede. Lê o `next.config.ts` de cada app — o mesmo arquivo que o
 * build lê — e afirma a RELAÇÃO entre endereços, não os literais.
 *
 * ## Por que `/vendas/servicos` é rewrite e não redirect
 *
 * Até 2026-11-11 existiu o redirect permanente inverso
 * (`servicos → procedimentos`). Navegador guarda 308 por tempo indeterminado:
 * um redirect de volta fecharia um laço na máquina de quem visitou a versão
 * antiga. O rewrite serve o conteúdo sem mexer na URL, e por isso é a única
 * forma segura aqui. O teste afirma isso, porque é a decisão que mais custa
 * reaprender.
 *
 *     pnpm run test:redirects
 */
import { readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

let passou = 0
let falhou = 0
function ok(nome: string, condicao: boolean, detalhe = '') {
    console.log(`  ${condicao ? 'ok ' : 'FALHOU'} ${nome}${detalhe ? `  — ${detalhe}` : ''}`)
    if (condicao) passou++
    else falhou++
}

type Regra = { source: string; destination: string; permanent?: boolean }

/** Os apps são DESCOBERTOS, não listados: um app novo entra testado. */
const apps = readdirSync('apps').filter((n) => existsSync(join('apps', n, 'next.config.ts')))
ok('há app com next.config.ts', apps.length > 0, apps.join(', '))

/**
 * Os slugs que mudaram de nome e precisam continuar resolvendo.
 *
 * A chave é o endereço ANTIGO — o que alguém guardou — e o valor é o neutro de
 * hoje. A lista é curta de propósito: cada linha é um link que existe no mundo.
 */
const LEGADOS: Record<string, string> = {
    '/vendas/pacientes': '/vendas/clientes',
    '/vendas/contatos': '/vendas/clientes',
    '/vendas/especialistas': '/vendas/profissionais',
}
/** Este NÃO pode ser redirect — ver o cabeçalho. */
const SO_REWRITE = '/vendas/procedimentos'

for (const app of apps) {
    console.log(`\n${app}`)
    const mod = await import(resolve('apps', app, 'next.config.ts'))
    const cfg = (mod as { default?: unknown }).default ?? mod
    const c = cfg as {
        redirects?: () => Promise<Regra[]> | Regra[]
        rewrites?: () => Promise<unknown> | unknown
    }

    const redirects: Regra[] = (await (typeof c.redirects === 'function' ? c.redirects() : c.redirects)) ?? []
    const brutoRw = await (typeof c.rewrites === 'function' ? c.rewrites() : c.rewrites)
    const rewrites: Regra[] = Array.isArray(brutoRw)
        ? (brutoRw as Regra[])
        : [
              ...((brutoRw as { beforeFiles?: Regra[] })?.beforeFiles ?? []),
              ...((brutoRw as { afterFiles?: Regra[] })?.afterFiles ?? []),
              ...((brutoRw as { fallback?: Regra[] })?.fallback ?? []),
          ]

    ok('declara redirecionamentos', redirects.length > 0, `${redirects.length}`)

    for (const [antigo, novo] of Object.entries(LEGADOS)) {
        const r = redirects.find((x) => x.source === antigo)
        ok(`${antigo} ainda resolve`, Boolean(r), r ? `→ ${r.destination}` : 'SEM REGRA — link guardado quebra')
        if (r) {
            ok(`${antigo} aponta para o slug neutro`, r.destination === novo, `${r.destination} (esperado ${novo})`)
            ok(`${antigo} é permanente`, r.permanent === true, String(r.permanent))
        }
    }

    /*
     * Nenhuma regra aponta para si mesma — o laço que o renomeio em massa
     * criaria. Vale para redirect E rewrite: um rewrite para si mesmo não
     * lança, mas desperdiça um ciclo de resolução em toda requisição.
     */
    for (const r of [...redirects, ...rewrites]) {
        ok(`${r.source} não aponta para si mesmo`, r.source !== r.destination, r.destination)
    }

    /*
     * E nenhum destino é, por sua vez, origem de outra regra: A→B com B→C é
     * um salto duplo que o navegador faz calado, e com 308 cacheado em dois
     * níveis fica impossível de desfazer.
     */
    for (const r of redirects) {
        const seguinte = redirects.find((x) => x.source === r.destination)
        ok(`${r.source} não cai em outro redirect`, !seguinte, seguinte ? `${r.destination} → ${seguinte.destination}` : '')
    }

    const comoRedirect = redirects.find((x) => x.source === SO_REWRITE)
    ok(
        `${SO_REWRITE} NÃO é redirect (o inverso já existiu e fecharia laço)`,
        !comoRedirect,
        comoRedirect ? `virou redirect para ${comoRedirect.destination}` : 'é rewrite, como deve ser'
    )
    const comoRewrite = rewrites.find((x) => x.source === SO_REWRITE)
    ok(`${SO_REWRITE} é servido por rewrite`, Boolean(comoRewrite), comoRewrite ? `→ ${comoRewrite.destination}` : 'SEM REGRA')
}

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
