import './lib/marca-de-teste.ts'

import { renderToString } from 'react-dom/server'

import { FormularioPublico } from '@venn/core/rotas-jsx/f/[key]/FormularioPublico'
import { CONFIGURACAO_PADRAO, camposIniciais } from '@venn/core/lib/formularios/schema'

/**
 * O formulário público renderiza no servidor — e o fundo transparente **sai do
 * HTML**, não de um efeito.
 *
 * Duas coisas que nenhum lint pega:
 *
 * 1. `'use client'` diz onde o componente ganha interatividade, não onde é
 *    renderizado: o Next o renderiza no servidor no primeiro paint, e uma
 *    leitura de `document` no corpo derruba a página inteira (a classe do
 *    Error 1101 de 18/11/2026 — ver `test-widget-ssr.tsx`). Esta é a **página
 *    pública**: cair aqui é o site do cliente com um buraco.
 * 2. O "fundo transparente" que o Andre pediu em 20/11/2026 é CSS condicional.
 *    Um typecheck verde não distingue "transparente" de "sólido" — só o HTML
 *    distingue, e é ele que se mede aqui.
 *
 *     pnpm run test:formulario-ssr
 */

let falhou = false

function conferir(nome: string, condicao: boolean) {
    if (condicao) {
        console.log(`  ok  ${nome}`)
    } else {
        console.error(`FALHOU  ${nome}`)
        falhou = true
    }
}

const formulario = {
    chave: 'chave-de-teste-0123456789',
    nome: 'Fale com a gente',
    organizacao: 'Unidade de teste',
    campos: camposIniciais(),
}

function renderizar(fundo: 'solido' | 'transparente', embed: boolean): string {
    return renderToString(
        <FormularioPublico
            formulario={{
                ...formulario,
                config: { ...CONFIGURACAO_PADRAO, aparencia: { ...CONFIGURACAO_PADRAO.aparencia, fundo } },
            }}
            marca="Marca de teste"
            embed={embed}
        />
    )
}

try {
    const solido = renderizar('solido', true)
    conferir('o formulário renderiza no servidor sem lançar', solido.length > 0)
    conferir('sólido pinta a página e o cartão', solido.includes('bg-background') && solido.includes('bg-card'))
    conferir('sólido não zera o fundo do documento', !solido.includes('background:transparent'))
    conferir('os campos saem no HTML, não só no cliente', solido.includes('WhatsApp'))

    const transparente = renderizar('transparente', true)
    conferir(
        'transparente não pinta nem a página nem o cartão',
        !transparente.includes('bg-background') && !transparente.includes('bg-card')
    )
    // Sem isto o `body` da nossa página apareceria por trás do formulário no
    // `iframe`, e "transparente" entregaria o nosso branco em vez da página do
    // cliente.
    conferir('transparente zera o fundo do documento', transparente.includes('background:transparent'))

    /**
     * No **link direto** o fundo volta a ser sólido: ali nós somos a página, e
     * um formulário transparente sobre o branco do navegador com o tema escuro
     * seria texto claro sobre branco.
     */
    const linkDireto = renderizar('transparente', false)
    conferir('no link direto o transparente não vale', linkDireto.includes('bg-background'))
    conferir('e nada é dito ao documento', !linkDireto.includes('background:transparent'))
} catch (erro) {
    console.error('FALHOU  o formulário público lançou durante o render no servidor:')
    console.error(`        ${erro instanceof Error ? erro.message : String(erro)}`)
    process.exit(1)
}

if (falhou) process.exit(1)
console.log('\n✓ formulario-ssr: a página pública sobe, e o fundo escolhido está no HTML\n')
