/**
 * O botão de suporte não volta a flutuar sobre a área de trabalho.
 *
 *   node scripts/check-suporte.mjs
 *
 * ## O defeito que isto prende
 *
 * O widget do Venn Desk desenha a própria pílula "SUPORTE" com
 * `position: fixed` no canto inferior direito. Nos nossos painéis esse canto
 * **tem controle**: na tela de Conversas é onde ficam Enviar, anexo, áudio e
 * "sugerir com IA", e a pílula cobria os quatro. Reportado em 19/11/2026.
 *
 * O conserto é um par: `WidgetDoDesk` passa `flutuante={false}` e a barra de
 * cima ganha `<BotaoDeSuporte />`. **As duas metades têm de existir juntas** —
 * só a primeira esconde o suporte do produto, e só a segunda deixa dois botões
 * na tela, um deles em cima do Enviar.
 *
 * Nada no `tsc` nota a falta: `flutuante` tem padrão `true`, então apagar a
 * prop compila, builda e sobe. O que acusa é um cliente reclamando — de novo.
 *
 * Por isso a prova é de texto e não de tipo. Ela é grosseira de propósito:
 * procura as duas marcas e exige as duas.
 */
import { readFileSync } from 'node:fs'

import { resolverNoCodigo } from './lib/raizes-de-codigo.mjs'

let falhas = 0

function ok(nome, cond, extra = '') {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

const montagem = resolverNoCodigo('components/suporte/WidgetDoDesk.tsx')
const textoDaMontagem = readFileSync(montagem, 'utf8')

ok(
    'o launcher do Venn Desk é montado sem pílula flutuante',
    /<VennDeskLauncher\s+flutuante=\{false\}\s*\/>/.test(textoDaMontagem),
    'flutuante={false} em WidgetDoDesk'
)

const barra = resolverNoCodigo('components/layout/Topbar.tsx')
const textoDaBarra = readFileSync(barra, 'utf8')

ok(
    'e a barra de cima tem o botão que abre o painel',
    /<BotaoDeSuporte\s*\/>/.test(textoDaBarra) &&
        /from '\.\.\/suporte\/BotaoDeSuporte'/.test(textoDaBarra),
    'BotaoDeSuporte na Topbar'
)

/**
 * A ponte é o que liga as duas metades: sem ela o botão da barra não tem como
 * abrir um painel que vive fora da árvore dele. Conferida pela exportação,
 * porque é por ela que o core alcança o pacote.
 */
const ponte = resolverNoCodigo('desk-widget/src/index.ts')
const textoDaPonte = readFileSync(ponte, 'utf8')

ok(
    'o pacote exporta a ponte (abrir e assinar)',
    /abrirSuporte/.test(textoDaPonte) && /assinarSuporte/.test(textoDaPonte)
)

console.log(falhas === 0 ? '\nsuporte: o botão não flutua sobre o trabalho' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
