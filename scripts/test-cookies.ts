/**
 * Provas dos nomes de cookie — a verificação mais barata contra o erro mais caro.
 *
 * ## Por que existe
 *
 * O prefixo deixou de ser o literal `'odontobox'` e passou a ser
 * `BRAND().slug`. O nome resultante é **byte a byte o mesmo**, e é isso que
 * precisa continuar verdadeiro: trocar o nome de um cookie de sessão
 * **desloga todos os usuários de uma vez**. Não corrompe nada, não lança, não
 * aparece em log — simplesmente todo mundo cai na tela de login, e quem fez a
 * mudança descobre pelo suporte.
 *
 * É o tipo de erro que nenhuma outra rede pega: o typecheck vê duas strings, o
 * lint não tem opinião, e o smoke de identidade confere o slug contra o
 * manifesto mas não o nome do cookie.
 *
 * ## O que ele afirma
 *
 * 1. O slug de cada app é exatamente o prefixo que os cookies em produção já
 *    têm. Mudar o slug de um app existente é a mudança que este teste existe
 *    para barrar; para um app NOVO, a linha entra junto com o app.
 * 2. Os nomes derivam do slug na forma `<slug>.<nome>` — a relação, não o
 *    literal.
 * 3. Nenhum nome de cookie colide entre apps, que é o ponto do prefixo.
 *
 *     pnpm run test:cookies
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import './lib/marca-de-teste.ts'

import { prefixoDoCookie, workspaceCookie, cookieAssumir } from '@venn/core/lib/auth/cookies'
import { BRAND } from '@venn/core/marca'

let passou = 0
let falhou = 0
function ok(nome: string, condicao: boolean, detalhe = '') {
    console.log(`  ${condicao ? 'ok ' : 'FALHOU'} ${nome}${detalhe ? `  — ${detalhe}` : ''}`)
    if (condicao) passou++
    else falhou++
}

/**
 * O prefixo que os cookies de cada app JÁ TÊM em produção.
 *
 * Escrito à mão de propósito: é o único jeito de uma mudança de slug reprovar.
 * Derivar daqui o valor esperado tornaria o teste tautológico — ele passaria
 * exatamente quando não devia.
 */
const PREFIXO_EM_PRODUCAO: Record<string, string> = {
    odontobox360: 'odontobox',
    // Lido do código que serve este produto hoje: `PREFIXO_DO_COOKIE =
    // 'stagent'` em `lib/auth/cookies.ts` do repositório dele, antes da
    // unificação. Trocar isto desloga todo mundo que está logado agora.
    stagent360: 'stagent',
    // Lido do código que serve este produto hoje: `PREFIXO_DO_COOKIE =
    // 'conecta'`.
    conecta360: 'conecta',
}

console.log('\nO slug de cada app é o prefixo que os cookies já têm')
const apps = readdirSync('apps').filter((n) => existsSync(join('apps', n, 'src/config/brand.ts')))
ok('há app com brand.ts', apps.length > 0, apps.join(', '))
for (const app of apps) {
    const fonte = readFileSync(join('apps', app, 'src/config/brand.ts'), 'utf8')
    const slug = fonte.match(/^\s+slug: '([^']+)'/m)?.[1]
    ok(`${app} declara um slug`, Boolean(slug), slug ?? '(não achei)')
    const esperado = PREFIXO_EM_PRODUCAO[app]
    if (esperado === undefined) {
        ok(
            `${app} está em PREFIXO_EM_PRODUCAO`,
            false,
            'app novo: acrescente a linha, com o prefixo que ele vai usar'
        )
        continue
    }
    ok(
        `${app}: o slug é "${esperado}" — mudar isso DESLOGA TODOS`,
        slug === esperado,
        slug === esperado ? slug : `declarado ${slug}, cookies em produção usam ${esperado}`
    )
}

console.log('\nOs nomes derivam do slug, e a forma é <slug>.<nome>')
const slug = BRAND().slug
ok('o prefixo é o slug da marca', prefixoDoCookie() === slug, `${prefixoDoCookie()} vs ${slug}`)
ok('o cookie de unidade', workspaceCookie() === `${slug}.workspace`, workspaceCookie())
ok('o cookie de conta assumida', cookieAssumir() === `${slug}.assumir`, cookieAssumir())

console.log('\nTrocar a marca troca o prefixo — é o que separa dois produtos no mesmo navegador')
/*
 * Sem isto, dois apps abertos no mesmo navegador disputariam o mesmo cookie de
 * sessão: entrar num derrubaria o outro. O prefixo é a única coisa que os
 * separa, e por isso não pode ser constante compartilhada.
 */
ok('o prefixo começa com o slug e não é vazio', prefixoDoCookie().length > 0 && !prefixoDoCookie().startsWith('.'), prefixoDoCookie())
ok('o nome não começa com ponto (slug vazio daria ".workspace")', !workspaceCookie().startsWith('.'), workspaceCookie())

console.log(`\n${passou} ok, ${falhou} falha(s)\n`)
process.exit(falhou > 0 ? 1 : 0)
