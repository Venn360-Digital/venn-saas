/**
 * Prova as decisões do módulo de documentos, sem banco e sem Cloudflare.
 *
 *     pnpm run check:propostas
 *
 * ## Por que estas três coisas, e não outras
 *
 * O módulo tem uma superfície grande — rotas, telas, fila, e-mail —, e quase
 * tudo ali só se prova contra o banco ou em staging. O que **se** prova aqui é
 * exatamente onde um erro passa calado:
 *
 *   - **o cálculo**, porque um centavo de diferença entre a tela e o documento
 *     não derruba nada: sai num PDF que o cliente assina;
 *   - **a máquina de estado**, porque uma transição a mais permite editar uma
 *     proposta que o cliente já tem na mão, e a tela não acusa;
 *   - **as variáveis e o render**, porque marcador que vaza ou HTML que escapa
 *     errado aparece no documento do cliente, não no log.
 *
 * Por isso essas três partes são funções puras em `lib/propostas/`, e o resto
 * (transação, Prisma, fila) é casca fina em volta. A mesma separação de
 * `lib/funil/passos.ts` e por exatamente a mesma razão.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import {
    calcularItem,
    calcularTotais,
    CASAS_DO_DINHEIRO,
    dinheiroEmTexto,
    quantidadeEmTexto,
} from '@venn/core/lib/propostas/calculo'
import {
    aceitaEdicaoDeItens,
    aceitaNovaRevisao,
    ARTIGO_DO_TIPO,
    ehEstado,
    ehTerminal,
    ehTipoDeDocumento,
    ESTADOS,
    podeTransicionar,
    ROTULO_DO_ESTADO,
    ROTULO_DO_TIPO,
    TIPOS_DE_DOCUMENTO,
    transicoesDe,
    type EstadoDaRevisao,
} from '@venn/core/lib/propostas/estados'
import {
    AJUDA_DO_MARCADOR,
    aplicarVariaveis,
    ehMarcador,
    MARCADORES,
    marcadoresCitados,
} from '@venn/core/lib/propostas/variaveis'
import { renderDocumento, tabelaDeItens } from '@venn/core/lib/propostas/render'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

// ============================================================ o cálculo

console.log('\n── cálculo ──')

{
    const t = calcularTotais([{ quantity: 2, unitPrice: '150.00', discountPct: 0 }])
    ok('item simples: 2 x 150 = 300', t.total.toString() === '300')
    ok('sem desconto, subtotal = total', t.subtotal.equals(t.total) && t.discount.isZero())
}

{
    // O caso que motivou `Decimal`: em `Float`, 0.1 + 0.2 === 0.30000000000000004,
    // e três itens de 1/3 de real não somam um real.
    const t = calcularTotais([
        { quantity: 1, unitPrice: '0.10', discountPct: 0 },
        { quantity: 1, unitPrice: '0.20', discountPct: 0 },
    ])
    ok('0,10 + 0,20 = 0,30 exato', t.total.toString() === '0.3', t.total.toString())
}

{
    const t = calcularTotais([{ quantity: 1, unitPrice: '1000.00', discountPct: '10' }])
    ok('desconto de 10% em 1000 = 100', t.discount.toString() === '100')
    ok('total = subtotal - desconto', t.total.equals(t.subtotal.minus(t.discount)))
    ok('total com desconto = 900', t.total.toString() === '900')
}

{
    // A invariante que o CHECK do banco verifica. Se ela falhar aqui, a gravação
    // é recusada pelo Postgres — o que é melhor que sair errado, mas o erro
    // apareceria como 500 numa rota, longe da causa.
    const casos = [
        [{ quantity: '3', unitPrice: '33.33', discountPct: '7.5' }],
        [
            { quantity: '1', unitPrice: '0.01', discountPct: '33.3333' },
            { quantity: '7', unitPrice: '12.34', discountPct: '0' },
            { quantity: '0.5', unitPrice: '2.4567', discountPct: '100' },
        ],
        [{ quantity: '1000000', unitPrice: '999.99', discountPct: '0.0001' }],
    ]
    let todas = true
    for (const itens of casos) {
        const t = calcularTotais(itens)
        if (!t.total.equals(t.subtotal.minus(t.discount))) todas = false
    }
    ok('total = subtotal - desconto em todos os casos difíceis', todas)
}

{
    /**
     * A decisão de ordem: a LINHA arredonda, o total não.
     *
     * Quem recebe uma proposta soma as linhas na calculadora. Se o arredondamento
     * fosse no fim, as linhas impressas não fechariam com o total impresso — por
     * um ou dois centavos, que é exatamente o tipo de diferença que faz um
     * cliente desconfiar do documento inteiro.
     */
    const itens = [
        { quantity: '3', unitPrice: '2.4567', discountPct: '0' },
        { quantity: '3', unitPrice: '2.4567', discountPct: '0' },
    ]
    const t = calcularTotais(itens)
    const somaDasLinhas = t.itens.reduce((s, i) => s.plus(i.total), t.itens[0].total.mul(0))
    ok(
        'a soma das linhas impressas é o total impresso',
        somaDasLinhas.equals(t.total),
        `linhas=${somaDasLinhas.toString()} total=${t.total.toString()}`
    )
    ok('cada linha tem no máximo 2 casas', t.itens.every((i) => i.total.decimalPlaces() <= CASAS_DO_DINHEIRO))
}

{
    const i = calcularItem({ quantity: '1', unitPrice: '100.00', discountPct: '33.3333' })
    // 100 * 0.333333 = 33.3333 -> 33.33; total = 66.67. As duas parcelas
    // arredondadas separadamente, e a subtração fecha.
    ok('desconto fracionado arredonda e fecha', i.bruto.minus(i.desconto).equals(i.total), i.total.toString())
    ok('desconto de 33,3333% em 100 = 33,33', i.desconto.toString() === '33.33', i.desconto.toString())
}

{
    const t = calcularTotais([{ quantity: '2', unitPrice: '50', discountPct: '100' }])
    ok('100% de desconto zera o total', t.total.isZero() && t.discount.toString() === '100')
}

{
    const t = calcularTotais([])
    ok(
        'revisão sem item soma zero (é o estado normal do rascunho)',
        t.subtotal.isZero() && t.discount.isZero() && t.total.isZero() && t.itens.length === 0
    )
}

{
    // Formatação: duas casas SEMPRE, inclusive em valor redondo. "R$ 1.200" num
    // orçamento parece truncado.
    const texto = dinheiroEmTexto('1200')
    ok('valor redondo sai com centavos', texto.includes('1.200,00'), texto)
    ok('quantidade inteira sai sem casas', quantidadeEmTexto('1') === '1', quantidadeEmTexto('1'))
    ok('quantidade fracionada mantém a fração', quantidadeEmTexto('0.5') === '0,5', quantidadeEmTexto('0.5'))
}

// ============================================================ a máquina de estado

console.log('\n── máquina de estado ──')

ok('oito estados', ESTADOS.length === 8)
ok('todo estado tem rótulo', ESTADOS.every((e) => (ROTULO_DO_ESTADO[e] ?? '').length > 0))
ok('rótulo não é o identificador cru', ESTADOS.every((e) => !ROTULO_DO_ESTADO[e].includes('_')))

ok('rascunho -> enviada (o caminho de hoje)', podeTransicionar('rascunho', 'enviada'))
ok('rascunho -> em_aprovacao (quando houver alçada)', podeTransicionar('rascunho', 'em_aprovacao'))
ok('enviada -> aceita', podeTransicionar('enviada', 'aceita'))
ok('enviada -> recusada', podeTransicionar('enviada', 'recusada'))
ok('enviada -> expirada', podeTransicionar('enviada', 'expirada'))
ok('em_aprovacao -> aprovada', podeTransicionar('em_aprovacao', 'aprovada'))
ok('aprovada -> enviada', podeTransicionar('aprovada', 'enviada'))

/**
 * As recusas que são a razão do módulo existir.
 *
 * "Voltar para rascunho" não é transição: de recusada, reprovada ou expirada
 * nasce uma REVISÃO NOVA. Se este teste passar a falhar, alguém abriu o caminho
 * de editar no lugar — e a pergunta "qual versão o cliente aprovou?" perde a
 * resposta, que é a única coisa que este módulo garante.
 */
ok('aceita é terminal', ehTerminal('aceita') && transicoesDe('aceita').length === 0)
ok('recusada NÃO volta para rascunho', !podeTransicionar('recusada', 'rascunho'))
ok('reprovada NÃO volta para rascunho', !podeTransicionar('reprovada', 'rascunho'))
ok('expirada NÃO volta para rascunho', !podeTransicionar('expirada', 'rascunho'))
ok('enviada NÃO volta para rascunho', !podeTransicionar('enviada', 'rascunho'))
ok('aceita não vira recusada', !podeTransicionar('aceita', 'recusada'))
ok('rascunho não pula para aceita', !podeTransicionar('rascunho', 'aceita'))

{
    // Varredura do grafo inteiro: nenhuma transição apareceu por acidente, e
    // nenhum estado aponta para si mesmo.
    let autoLaco = false
    let alvoInvalido = false
    for (const de of ESTADOS) {
        for (const para of transicoesDe(de)) {
            if (de === para) autoLaco = true
            if (!ehEstado(para)) alvoInvalido = true
        }
    }
    ok('nenhum estado transiciona para si mesmo', !autoLaco)
    ok('todo alvo de transição é um estado válido', !alvoInvalido)

    const total = ESTADOS.reduce((n, e) => n + transicoesDe(e).length, 0)
    ok('o grafo tem exatamente 8 arestas', total === 8, `${total}`)
}

ok('estado desconhecido não transiciona', !podeTransicionar('inventado', 'enviada'))
ok('estado desconhecido não é estado', !ehEstado('EM_APROVACAO'))

ok('só rascunho aceita edição de item', aceitaEdicaoDeItens('rascunho'))
ok('revisão enviada NÃO aceita edição de item', !aceitaEdicaoDeItens('enviada'))
ok('revisão em aprovação NÃO aceita edição de item', !aceitaEdicaoDeItens('em_aprovacao'))

ok('em_aprovacao recusa revisão nova (duas versões vivas)', !aceitaNovaRevisao('em_aprovacao'))
ok('recusada aceita revisão nova', aceitaNovaRevisao('recusada'))
ok('aceita aceita revisão nova (renegociação)', aceitaNovaRevisao('aceita'))

// Os três tipos: um ciclo de vida, três rótulos.
ok('três tipos de documento', TIPOS_DE_DOCUMENTO.length === 3)
ok('todo tipo tem rótulo e artigo', TIPOS_DE_DOCUMENTO.every((t) => ROTULO_DO_TIPO[t] && ARTIGO_DO_TIPO[t]))
ok('tipo desconhecido é recusado', !ehTipoDeDocumento('pedido'))

// ============================================================ variáveis

console.log('\n── variáveis ──')

ok('todo marcador tem ajuda', MARCADORES.every((m) => (AJUDA_DO_MARCADOR[m] ?? '').length > 0))
ok('cliente e total são marcadores', ehMarcador('cliente') && ehMarcador('total'))
ok('preco não é marcador', !ehMarcador('preco'))

{
    const saida = aplicarVariaveis('Para: {{cliente}}', { cliente: 'Maria Silva' })
    ok('troca o valor', saida === 'Para: Maria Silva', saida)
}

{
    /**
     * Marcador desconhecido fica VISÍVEL.
     *
     * Apagá-lo em silêncio esconderia o erro de digitação até o documento já
     * estar com o cliente. À vista, a prévia na tela o acusa antes.
     */
    const saida = aplicarVariaveis('Valor: {{preco}}', {})
    ok('marcador desconhecido continua à vista', saida === 'Valor: {{preco}}', saida)
}

{
    // A regra da pontuação órfã, herdada de `blocos.ts`. É o motivo de o motor
    // ser compartilhado em vez de reescrito.
    const saida = aplicarVariaveis('Para {{cliente}}, com validade.', {})
    ok('substituição vazia engole a vírgula órfã', saida === 'Para com validade.', `"${saida}"`)
}

{
    const saida = aplicarVariaveis('Validade: {{validade|sem prazo}}', {})
    ok('queda escrita no marcador vale', saida === 'Validade: sem prazo', saida)
}

{
    const saida = aplicarVariaveis('Total {{total}} em {{data}}', {
        total: 'R$ 1.200,00',
        data: '21/11/2026',
    })
    ok('dois marcadores na mesma frase', saida === 'Total R$ 1.200,00 em 21/11/2026', saida)
}

{
    const citados = marcadoresCitados('{{cliente}} e {{total}} e {{cliente}} e {{preco}}')
    ok('lista os citados sem repetir', citados.length === 3, citados.join(','))
    ok('inclui o que não existe (para o aviso)', citados.includes('preco'))
}

// ============================================================ render

console.log('\n── render ──')

const ITENS = [
    { description: 'Avaliação', quantity: '1', unitPrice: '150.00', discountPct: '0', total: '150.00', unit: 'sessão' },
    { description: 'Clareamento', quantity: '2', unitPrice: '400.00', discountPct: '0', total: '800.00' },
]

{
    const totais = calcularTotais([
        { quantity: '1', unitPrice: '150.00', discountPct: '0' },
        { quantity: '2', unitPrice: '400.00', discountPct: '0' },
    ])
    const html = tabelaDeItens(ITENS, totais, 'BRL')
    ok('a tabela traz as descrições', html.includes('Avaliação') && html.includes('Clareamento'))
    ok('a tabela traz a unidade do item', html.includes('sessão'))
    ok('a tabela traz o total', html.includes('950,00'), '950,00')
    /**
     * Sem desconto nenhum, a coluna de desconto NÃO aparece.
     *
     * Uma coluna de zeros é ruído num documento que o cliente lê — e pior,
     * sugere que havia desconto a negociar.
     */
    ok('sem desconto, sem coluna de desconto', !html.includes('Desc.'))
    ok('sem desconto, sem linha de subtotal', !html.includes('Subtotal'))
}

{
    const comDesconto = [{ ...ITENS[0], discountPct: '10', total: '135.00' }]
    const totais = calcularTotais([{ quantity: '1', unitPrice: '150.00', discountPct: '10' }])
    const html = tabelaDeItens(comDesconto, totais, 'BRL')
    ok('com desconto, a coluna aparece', html.includes('Desc.'))
    ok('com desconto, o subtotal aparece', html.includes('Subtotal'))
}

{
    const html = tabelaDeItens([], { subtotal: 0, discount: 0, total: 0 } as never, 'BRL')
    ok('revisão sem item não quebra o render', html.includes('Nenhum item'))
}

{
    /**
     * O escape é a defesa, porque não há sanitizador no projeto.
     *
     * Se este teste falhar, uma descrição de item com `<script>` vira script
     * executado na página pública — a única rota do produto sem autenticação.
     */
    const malicioso = [
        {
            description: '<script>alert(1)</script>',
            quantity: '1',
            unitPrice: '10',
            discountPct: '0',
            total: '10',
        },
    ]
    const html = tabelaDeItens(malicioso, { subtotal: 10, discount: 0, total: 10 } as never, 'BRL')
    ok('descrição com HTML é escapada', !html.includes('<script>') && html.includes('&lt;script&gt;'))
}

{
    const doc = renderDocumento({
        corpo: '# {{titulo}}\n\nPara: {{cliente}}\n\n{{itens}}\n\n- primeiro\n- segundo',
        variaveis: { titulo: 'Plano de tratamento', cliente: 'Maria Silva' },
        itens: ITENS,
        totais: calcularTotais([
            { quantity: '1', unitPrice: '150.00', discountPct: '0' },
            { quantity: '2', unitPrice: '400.00', discountPct: '0' },
        ]),
        moeda: 'BRL',
    })
    ok('o título vira h2', doc.includes('<h2>Plano de tratamento</h2>'))
    ok('o parágrafo vira p', doc.includes('<p>Para: Maria Silva</p>'))
    ok('a lista vira ul/li', doc.includes('<ul>') && doc.includes('<li>primeiro</li>'))
    /**
     * A tabela NÃO fica dentro de um parágrafo.
     *
     * Tabela dentro de `<p>` é HTML inválido e o navegador a move para fora,
     * desmontando a ordem do documento: os itens saltam para antes do título.
     */
    ok('a tabela não ficou dentro de um parágrafo', !doc.includes('<p><table'))
    ok('o marcador de itens não sobrou no texto', !doc.includes('{{itens}}'))
    ok('a tabela entrou', doc.includes('<table class="doc-itens"'))
}

{
    // Proposta sem template tem de abrir: quem acabou de instalar o produto não
    // deveria passar pela tela de modelos antes de mandar a primeira.
    const doc = renderDocumento({
        corpo: null,
        variaveis: { titulo: 'Orçamento', cliente: 'João' },
        itens: ITENS,
        totais: calcularTotais([{ quantity: '1', unitPrice: '150.00', discountPct: '0' }]),
        moeda: 'BRL',
    })
    ok('sem template, o corpo padrão responde', doc.includes('Orçamento') && doc.includes('<table'))
}

{
    /**
     * Valor de variável não carrega HTML para o documento.
     *
     * O nome do contato vem do banco, e o banco aceita qualquer texto: um
     * contato chamado `<img onerror=...>` não pode virar tag na página pública.
     */
    const doc = renderDocumento({
        corpo: 'Para: {{cliente}}',
        variaveis: { cliente: '<img src=x onerror=alert(1)>' },
        itens: [],
        totais: { subtotal: 0, discount: 0, total: 0 } as never,
        moeda: 'BRL',
    })
    ok('valor de variável é escapado', !doc.includes('<img') && doc.includes('&lt;img'))
}

{
    /**
     * A prévia e a página pública chamam a MESMA função.
     *
     * Este teste não prova as duas telas; prova que o render é determinístico,
     * que é a condição para elas não poderem divergir. Duas chamadas com a
     * mesma entrada dão a mesma saída — sem data de agora, sem aleatório.
     */
    const entrada = {
        corpo: '# {{titulo}}\n\n{{itens}}',
        variaveis: { titulo: 'Proposta' },
        itens: ITENS,
        totais: calcularTotais([{ quantity: '1', unitPrice: '150.00', discountPct: '0' }]),
        moeda: 'BRL',
    }
    ok('o render é determinístico', renderDocumento(entrada) === renderDocumento(entrada))
}

// ============================================================ fecho

console.log('')
if (falhas > 0) {
    console.log(`${falhas} FALHA(S)`)
    process.exitCode = 1
} else {
    console.log('tudo passou')
}

// Mantém o tipo em uso: o `EstadoDaRevisao` existe para as rotas, e importá-lo
// aqui garante que ele continue exportado.
const _estado: EstadoDaRevisao = 'rascunho'
void _estado
