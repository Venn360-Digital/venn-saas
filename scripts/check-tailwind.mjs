#!/usr/bin/env node
/**
 * A varredura do Tailwind alcança o código onde ele está?
 *
 * ## O buraco que isto fecha
 *
 * O Tailwind v4 descobre as classes lendo os arquivos — e no monorepo ele
 * **não varre `packages/` sozinho**: cada `globals.css` tem de declarar
 * `@source`. Esquecer essa linha não quebra nada que uma ferramenta note: o
 * typecheck passa, o eslint passa, o build passa, e o app vai ao ar **sem o
 * CSS dos componentes movidos**. É o falso verde mais caro da Fase 2, porque
 * só aparece aos olhos de quem abre a tela.
 *
 * Em 14/11 o mesmo padrão já custou três builds de outra forma (o lint de
 * migração tratando arquivo movido como novo) e quase custou a rede de
 * isolamento multi-tenant (`lint-workspace` varrendo `src/` fixo). A diferença
 * aqui é que não há nem falha nem aviso: há uma tela sem estilo.
 *
 * ## Como prova
 *
 * Gera o CSS de verdade, com o mesmo plugin do build, e procura classes
 * SENTINELA — utilitárias que existem em um único lugar do código. Se a classe
 * está no CSS, a varredura alcançou aquele arquivo. Se o arquivo mudou de
 * pacote e o `@source` não acompanhou, a classe desaparece do CSS e isto
 * reprova, no commit que move.
 *
 * Cada sentinela declara o arquivo de onde vem. O script confere as duas
 * pontas: que o arquivo ainda existe (em qualquer raiz) e que a classe saiu no
 * CSS. Arquivo sumido é erro próprio — sentinela que aponta para o nada passa
 * a provar nada, e passaria calada.
 */
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { arquivosDeCodigo, configuracoesDeApp } from './lib/raizes-de-codigo.mjs'

/**
 * Uma entrada de CSS por app, DERIVADA — não listada.
 *
 * Eram dois caminhos escritos à mão, um da transição e um do app. Listar não
 * escala para três apps, e a entrada obsoleta ficava para trás silenciosamente
 * (filtrada por `existsSync`, ou seja: um caminho errado parecia só ausente).
 * Agora os apps são descobertos, e cada `globals.css` é verificado — se um app
 * novo não alcançar os pacotes, é ele que reprova, não a média.
 */
const ENTRADAS = configuracoesDeApp('src/app/globals.css')

/**
 * Classe → arquivo que a contém, e só ele.
 *
 * Escolhidas por serem variantes compostas e raras: aparecem no CSS gerado com
 * forma inconfundível, e nenhum outro arquivo as usa (conferido por grep ao
 * declará-las). Se uma delas deixar de ser exclusiva, o teste não fica errado
 * — fica apenas menos preciso sobre QUAL arquivo foi alcançado.
 */
const SENTINELAS = [
    { classe: 'in-data-[side=left]:cursor-w-resize', deArquivo: 'ui/src/sidebar.tsx' },
    { classe: 'peer-data-[variant=inset]:rounded-xl', deArquivo: 'ui/src/sidebar.tsx' },
    { classe: 'group-data-[collapsible=icon]:hidden', deArquivo: 'ui/src/sidebar.tsx' },
]

/**
 * O CSS gerado escapa o seletor: `in-data-[side=left]:cursor-w-resize` sai como
 * `.in-data-\[side\=left\]\:cursor-w-resize`. Tirar as barras e procurar a
 * classe literal é mais robusto que uma regex que tenta prever cada escape —
 * a primeira versão deste script usava regex e deu falso NEGATIVO nas três
 * sentinelas, o que teria me feito "consertar" um `@source` que não faltava.
 */
const desescapar = (css) => css.replace(/\\/g, '')

let falhas = 0
const todos = arquivosDeCodigo()

for (const s of SENTINELAS) {
    const onde = todos.filter((f) => f.endsWith(s.deArquivo))
    if (onde.length === 0) {
        console.error(`✖ a sentinela "${s.classe}" aponta para "${s.deArquivo}", que não existe em nenhuma raiz.`)
        console.error('  Sentinela órfã não prova nada. Atualize-a no commit que moveu o arquivo.')
        falhas++
    } else if (onde.length > 1) {
        console.error(`✖ "${s.deArquivo}" casa com ${onde.length} arquivos: ${onde.join(', ')}`)
        console.error('  Ambíguo: a sentinela deixaria de dizer qual deles foi alcançado.')
        falhas++
    }
}

for (const entrada of ENTRADAS) {
    const css = await postcss([tailwind()]).process(readFileSync(entrada, 'utf8'), { from: entrada })
    const saida = desescapar(css.css)
    console.log(`${entrada}: ${(css.css.length / 1024).toFixed(0)} KB de CSS gerado`)
    for (const s of SENTINELAS) {
        const presente = saida.includes(s.classe)
        console.log(`  ${presente ? '✔' : '✖'} ${s.classe}  (de ${s.deArquivo})`)
        if (!presente) {
            console.error(
                `\n✖ a classe "${s.classe}" não saiu no CSS de ${entrada}.\n` +
                `  O arquivo "${s.deArquivo}" existe, mas a varredura do Tailwind não o\n` +
                '  alcança. Declare o caminho dele com `@source` nesse globals.css — o\n' +
                '  Tailwind v4 não varre `packages/` por conta própria.\n'
            )
            falhas++
        }
    }
}

if (falhas > 0) process.exit(1)
console.log('\nA varredura do Tailwind alcança os componentes.')
