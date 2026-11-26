/**
 * `SelectLabel` sem `SelectGroup` derruba a tela — portão, não revisão.
 *
 * ## O defeito que isto existe para pegar
 *
 * O `SelectLabel` do Radix lê o contexto do grupo, e o consumidor de contexto
 * **lança** quando o provedor não existe: ``SelectLabel` must be used within
 * `SelectGroup``. Não é aviso nem degradação — é exceção, e ela sobe até o
 * limite de erro da rota, que troca a tela inteira pelo cartão "Não foi
 * possível carregar".
 *
 * **E lança no carregamento, não ao abrir a lista.** `SelectContent` fechado
 * ainda monta os filhos dentro de um `DocumentFragment` para recolher os itens
 * (ver `node_modules/@radix-ui/react-select`, o ramo `if (!context.open)`).
 * Então o seletor nem precisa ser aberto para a página morrer.
 *
 * Aconteceu em 26/11/2026, em homologação: a aba Canais caiu no instante em que
 * a primeira linha de WhatsApp passou a existir na unidade. Antes disso a
 * tabela não renderizava linha nenhuma, o seletor novo nunca era montado, e
 * typecheck, lints e testes passavam todos — nenhum deles renderiza componente.
 * O defeito estava a uma mesclagem de produção, onde **toda** clínica com um
 * número conectado veria a mesma tela.
 *
 * ## Por que uma varredura de texto, e não um teste de render
 *
 * Não há jsdom nem testing-library no repositório, e o caminho que explode é
 * justamente o do navegador (`useLayoutEffect` + `DocumentFragment` + portal):
 * em `react-dom/server` ele devolve `null` e **não** lança. Um teste de SSR
 * daria verde sobre o defeito. A regra, porém, é estrutural e local — "este
 * rótulo está dentro de um grupo?" —, e isso o texto responde.
 *
 * ## A regra
 *
 * Para cada `<SelectLabel` de um `.tsx`, conta as aberturas e os fechamentos de
 * `<SelectGroup` que vêm antes dele no arquivo. Se houver grupo aberto e não
 * fechado, o rótulo está dentro de um. É contagem de profundidade, não análise
 * sintática: serve porque JSX é bem formado por construção — o compilador já
 * recusaria uma marca sem par.
 */
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

const RAIZES = [
    'packages/config/src',
    'packages/core/src',
    'packages/db/src',
    'packages/desk-widget/src',
    'packages/ui/src',
    'apps/conecta360/src',
    'apps/odontobox360/src',
    'apps/stagent360/src',
]

/**
 * O próprio invólucro do design system fica de fora: é ele que **define**
 * `SelectLabel`, e lá a palavra aparece sem grupo por definição.
 */
const ISENTOS = new Set(['packages/ui/src/select.tsx'])

const arquivos = RAIZES.flatMap((raiz) => {
    try {
        return globSync(`${raiz}/**/*.tsx`)
    } catch {
        // Raiz que não existe não é erro: nem todo app tem toda pasta.
        return []
    }
}).filter((f) => !ISENTOS.has(f))

const achados = []

for (const arquivo of arquivos) {
    const texto = readFileSync(arquivo, 'utf8')
    if (!texto.includes('<SelectLabel')) continue

    for (const m of texto.matchAll(/<SelectLabel[\s>]/g)) {
        const antes = texto.slice(0, m.index)
        const abertos = (antes.match(/<SelectGroup[\s>]/g) ?? []).length
        const fechados = (antes.match(/<\/SelectGroup>/g) ?? []).length
        if (abertos > fechados) continue

        const linha = antes.split('\n').length
        achados.push(`${arquivo}:${linha}`)
    }
}

if (achados.length > 0) {
    console.error(
        `lint-select-group: ${achados.length} \`SelectLabel\` fora de \`SelectGroup\`.\n` +
            'O Radix LANÇA nesse caso, e lança no carregamento da tela — o\n' +
            '`SelectContent` fechado monta os filhos para recolher os itens.\n' +
            'Envolva o rótulo e os itens dele num `<SelectGroup>`.\n'
    )
    for (const a of achados) console.error(`  ${a}`)
    process.exit(1)
}

console.log(
    `lint-select-group: ${arquivos.length} arquivo(s) varrido(s); ` +
        'todo `SelectLabel` está dentro de um `SelectGroup`.'
)
