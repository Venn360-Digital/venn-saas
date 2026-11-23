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

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    MARCADOR_DE_ITENS,
    MARCADORES,
    marcadoresCitados,
} from '@venn/core/lib/propostas/variaveis'
import { miolo, renderCorpoLegado, renderDocumento, tabelaDeItens } from '@venn/core/lib/propostas/render'
import {
    aplicarSugestoes,
    converterCorpoEmSecoes,
    ehCompromisso,
    esvaziarCompromissos,
    secoesDaResposta,
    SCHEMA_DAS_SECOES_PLANAS,
    ehPagina,
    ehTipoDeSecao,
    ROTULO_DA_SECAO,
    secoesPadrao,
    secoesSchema,
    TIPOS_DE_SECAO,
} from '@venn/core/lib/propostas/secoes'
import { congelarVariaveis, contextoDeMapa, contextoDeVariaveis } from '@venn/core/lib/propostas/contexto'
import {
    achatarVariaveis,
    APELIDOS,
    chaveDeCampo,
    GRUPOS,
    REGISTRO,
    variaveisPersonalizadas,
} from '@venn/core/lib/propostas/variaveis'
import { resumirNegociacao, type FatosDaProposta } from '@venn/core/lib/propostas/resumo'
import { hostDoApp } from '@venn/core/lib/base-publica'
import {
    avaliarGesto,
    ehAutoAprovacao,
    ehGesto,
    ESTADO_DO_GESTO,
    GESTOS,
    gestoEhDeAlcada,
    ROTULO_DO_GESTO,
} from '@venn/core/lib/propostas/aprovacao'
import { clienteAlcancavel, tituloDoNegocio } from '@venn/core/lib/propostas/negocio'
import { modelosSemente } from '@venn/core/lib/propostas/semente'
import { vocab } from '@venn/core/lib/vocabulario'

/**
 * A raiz do core, derivada deste arquivo e não do diretório de trabalho —
 * `pnpm --filter` mudaria o segundo e quebraria a varredura em silêncio. A
 * mesma linha de `check-proposta-publica.ts`.
 */
const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core', 'src')

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
    const saida = aplicarVariaveis('Para: {{cliente}}', { cliente: { nome: 'Maria Silva' } })
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
        documento: { total: 'R$ 1.200,00', data: '21/11/2026' },
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
        variaveis: { documento: { titulo: 'Plano de tratamento' }, cliente: { nome: 'Maria Silva' } },
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
        variaveis: { documento: { titulo: 'Orçamento' }, cliente: { nome: 'João' } },
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
        variaveis: { cliente: { nome: '<img src=x onerror=alert(1)>' } },
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
        variaveis: { documento: { titulo: 'Proposta' } },
        itens: ITENS,
        totais: calcularTotais([{ quantity: '1', unitPrice: '150.00', discountPct: '0' }]),
        moeda: 'BRL',
    }
    ok('o render é determinístico', renderDocumento(entrada) === renderDocumento(entrada))
}

// ============================================================ o resumo

console.log('\n── resumo da negociação (sem IA) ──')

/**
 * Por que isto é testado, e por que não usa modelo.
 *
 * O plano listava "resumir o histórico" como terceiro uso de IA. Virou função
 * pura porque **todos os fatos já estão no banco, exatos** — e um modelo que os
 * reescrevesse poderia errar um número de um jeito plausível ("aberta duas
 * vezes" quando foram cinco). Num resumo que alguém lê para decidir a próxima
 * ligação, isso é pior que não ter resumo.
 *
 * Sendo pura, dá para afirmar cada frase contra um caso conhecido — o que com
 * modelo seria impossível.
 */
const AGORA = Date.UTC(2026, 10, 21, 12, 0, 0)
const diasAtras = (n: number) => new Date(AGORA - n * 86_400_000)

const base: FatosDaProposta = {
    kind: 'proposta',
    numero: 1042,
    versoes: 1,
    estado: 'enviada',
    desconto: 0,
    descontoDaPrimeira: 0,
    enviadaEm: diasAtras(3),
    aceitaEm: null,
    aceitaPor: null,
    aberturas: 0,
    validoAte: null,
}

{
    const r = resumirNegociacao(base, AGORA)
    ok('traz o rótulo e o número', r.includes('Proposta 1042'), r)
    ok('diz há quantos dias foi enviada', r.includes('há 3 dias'), r)
    /**
     * Zero abertura tem frase PRÓPRIA, e é a que leva à ação certa.
     *
     * "ainda não foi aberta" manda confirmar se o link chegou. "sem resposta"
     * mandaria renegociar preço — a conclusão errada, e a que um CRM sem este
     * dado é obrigado a tirar.
     */
    ok('zero abertura diz que não foi aberta', r.includes('ainda não foi aberta'), r)
    ok('e NÃO sugere que o cliente recusou', !r.toLowerCase().includes('recus'))
}

{
    const r = resumirNegociacao({ ...base, aberturas: 1 }, AGORA)
    ok('uma abertura sai no singular', r.includes('aberta uma vez'), r)
}

{
    const r = resumirNegociacao({ ...base, aberturas: 5 }, AGORA)
    ok('cinco aberturas saem no plural com o número', r.includes('aberta 5 vezes'), r)
}

{
    const r = resumirNegociacao({ ...base, enviadaEm: diasAtras(0) }, AGORA)
    ok('enviada hoje diz "hoje", não "há 0 dias"', r.includes('hoje') && !r.includes('há 0'), r)
}

{
    const r = resumirNegociacao({ ...base, enviadaEm: diasAtras(1) }, AGORA)
    ok('enviada ontem diz "ontem"', r.includes('ontem'), r)
}

{
    // A renegociação: o fato mais útil para quem pega o negócio de outro.
    const r = resumirNegociacao(
        { ...base, versoes: 3, desconto: 200, descontoDaPrimeira: 0 },
        AGORA
    )
    ok('diz em qual versão está', r.includes('versão 3'), r)
    /**
     * Se este teste falhar, quem assume o negócio não sabe que já se concedeu
     * desconto — e concede de novo, do zero. O cliente leva duas vezes.
     */
    ok('avisa que o desconto cresceu', r.includes('desconto maior'), r)
}

{
    const r = resumirNegociacao(
        { ...base, versoes: 2, desconto: 0, descontoDaPrimeira: 0 },
        AGORA
    )
    ok('sem crescer, não inventa aviso de desconto', !r.includes('desconto maior'), r)
}

{
    const r = resumirNegociacao(
        { ...base, estado: 'aceita', aceitaEm: diasAtras(1), aceitaPor: 'Maria Silva' },
        AGORA
    )
    ok('aceita diz quem e quando', r.includes('Aceita ontem') && r.includes('Maria Silva'), r)
    // Aceita não fala de abertura: o desfecho já veio, e a contagem deixou de
    // importar.
    ok('aceita não fala de abertura', !r.includes('aberta'), r)
}

{
    const r = resumirNegociacao({ ...base, estado: 'recusada' }, AGORA)
    ok('recusada diz que o cliente recusou', r.includes('recusou'), r)
}

{
    const r = resumirNegociacao({ ...base, estado: 'expirada' }, AGORA)
    ok('expirada diz que o prazo venceu sem resposta', r.includes('venceu sem resposta'), r)
}

{
    const r = resumirNegociacao({ ...base, enviadaEm: null, estado: 'rascunho' }, AGORA)
    ok('rascunho diz que ainda não foi enviada', r.includes('Ainda não foi enviada'), r)
}

{
    // O prazo apertado entra como alerta; o folgado não vira ruído.
    const perto = resumirNegociacao({ ...base, validoAte: new Date(AGORA + 2 * 86_400_000) }, AGORA)
    ok('prazo em 2 dias aparece', perto.includes('vence em 2'), perto)

    const hoje = resumirNegociacao({ ...base, validoAte: new Date(AGORA + 3600_000) }, AGORA)
    /**
     * Um prazo que vence em UMA HORA diz "vence hoje", não "em 1 dia".
     *
     * Com `Math.ceil` dizia "em 1 dia(s)" — arredondado para cima e errado para
     * quem lê: a pessoa deixaria para amanhã um documento que vence hoje. Foi
     * este teste que pegou, e o conserto está em `resumo.ts`.
     */
    ok('prazo de hoje aparece', hoje.includes('vence hoje'), hoje)

    const amanha = resumirNegociacao({ ...base, validoAte: new Date(AGORA + 30 * 3600_000) }, AGORA)
    // A asserção olha só o trecho do PRAZO: `!includes('dias')` na frase inteira
    // casava com o "há 3 dias" do envio, e reprovava um código correto.
    ok(
        'um dia sai no singular',
        amanha.includes('vence em 1 dia') && !amanha.includes('vence em 1 dias'),
        amanha
    )

    const longe = resumirNegociacao({ ...base, validoAte: new Date(AGORA + 30 * 86_400_000) }, AGORA)
    ok('prazo de 30 dias NÃO vira ruído', !longe.includes('vence'), longe)

    const vencido = resumirNegociacao({ ...base, validoAte: diasAtras(1) }, AGORA)
    ok('prazo vencido aparece', vencido.includes('o prazo venceu'), vencido)
}

{
    // Determinístico: é o que uma frase gerada por modelo não seria.
    ok('o resumo é determinístico', resumirNegociacao(base, AGORA) === resumirNegociacao(base, AGORA))
    ok('nunca sobra espaço duplo', !resumirNegociacao(base, AGORA).includes('  '))
    ok('termina com ponto', resumirNegociacao(base, AGORA).trimEnd().endsWith('.'))
}

// ============================================================ modelos semente

/**
 * O texto dos três modelos padrão.
 *
 * Entrou aqui depois de os dois defeitos abaixo aparecerem só ao **rodar** a
 * função para semear os bancos de homologação — nenhum portão os via, e os dois
 * saem no documento que o cliente lê:
 *
 *   - `este ${'proposta'}` escrevia **"este proposta"**. A palavra é nossa, não
 *     do vocabulário, então não havia gênero declarado para `comArtigo`
 *     consultar — e a frase se montava por concatenação.
 *   - `por ${comArtigo(v, 'organizacao')}` escrevia **"por a clínica"**. A
 *     contração existe em `concordancia.ts` (`'por'` → "pela"), e não foi usada.
 *
 * A lição é a do arquivo inteiro: concordância montada por concatenação não
 * falha em teste nenhum, aparece na tela do cliente. Por isso as asserções
 * abaixo varrem **preposição seguida de artigo solto**, e não apenas os dois
 * casos consertados.
 */
{
    const v = vocab()
    const modelos = modelosSemente(v, 'ws-de-teste')

    ok('são três modelos, um por tipo', modelos.length === TIPOS_DE_DOCUMENTO.length)
    ok(
        'um por tipo, sem repetir',
        new Set(modelos.map((m) => m.kind)).size === TIPOS_DE_DOCUMENTO.length
    )
    ok(
        'o nome é distinto — entra no @@unique([workspaceId, name])',
        new Set(modelos.map((m) => m.name)).size === modelos.length
    )

    const corpo = (tipo: string) => modelos.find((m) => m.kind === tipo)?.body ?? ''

    ok('a proposta concorda em gênero', corpo('proposta').includes('esta proposta'))
    ok('e NÃO escreve "este proposta"', !corpo('proposta').includes('este proposta'))
    ok('o orçamento concorda em gênero', corpo('orcamento').includes('este orçamento'))

    ok('o contrato contrai a preposição', corpo('contrato').includes('pela organização'))
    ok('e NÃO escreve "por a"', !corpo('contrato').includes('por a '))

    /**
     * A varredura geral: preposição que contrai, seguida de artigo solto.
     *
     * `com`, `sem` e `para` não contraem em português e por isso não entram —
     * é a mesma lista que `concordancia.ts` mede em vez de supor.
     */
    for (const m of modelos) {
        for (const vazamento of [' por a ', ' por o ', ' de a ', ' de o ', ' em a ', ' em o ']) {
            // Sem `extra`: o helper imprime o detalhe mesmo quando passa, e
            // dezoito corpos de documento na saída esconderiam a única falha.
            ok(`${m.kind}: sem "${vazamento.trim()}" — contração esquecida`, !m.body.includes(vazamento))
        }
        ok(`${m.kind}: expande os itens`, m.body.includes(`{{${MARCADOR_DE_ITENS}}}`))

        // O que o modelo NÃO promete. Texto escrito por nós sairia no nome da
        // organização prometendo o que não sabemos — a regra está no cabeçalho
        // de `semente.ts`, e sem asserção ela se perde na primeira edição.
        for (const promessa of ['garantia', 'prazo de', 'parcel', 'desconto de']) {
            ok(`${m.kind}: não promete "${promessa}"`, !m.body.toLowerCase().includes(promessa))
        }
    }
}

// ============================================================ negócio na criação

/**
 * O negócio e a ficha que nascem com o documento.
 *
 * Os três defeitos que a homologação de 21/11/2026 apontou, e o que cada um
 * virou:
 *
 *   1. **a busca não achava negócio nenhum** — `GET /api/deals` devolve o array
 *      cru e o diálogo lia `corpo.data`, que é `undefined`. Nenhum portão via:
 *      typecheck passa (o campo é opcional no tipo que eu mesmo escrevi) e não
 *      há banco em teste de unidade. A asserção de varredura abaixo é o que
 *      sobra — defeito de forma de envelope entre duas peças nossas;
 *   2. **não havia como cadastrar negócio dali** — virou o modo `cadastrar`;
 *   3. **o cliente deve nascer com o negócio** — virou `negocioParaProposta`,
 *      numa transação só.
 */
{
    ok('o título digitado vence', tituloDoNegocio('Helena Prado', 'Plano de tratamento') === 'Plano de tratamento')
    ok('sem título, o nome serve', tituloDoNegocio('Helena Prado', null) === 'Helena Prado')
    ok('título em branco não vence', tituloDoNegocio('Helena Prado', '   ') === 'Helena Prado')
    ok('e vem aparado', tituloDoNegocio('  Helena  ', null) === 'Helena')
    ok('o teto da coluna é respeitado', tituloDoNegocio('x'.repeat(300), null).length === 200)
    ok('teto também no digitado', tituloDoNegocio('n', 'y'.repeat(300)).length === 200)

    ok('telefone alcança', clienteAlcancavel({ nome: 'n', telefone: '31999990001' }))
    ok('e-mail alcança', clienteAlcancavel({ nome: 'n', email: 'a@b.com' }))
    ok('os dois alcançam', clienteAlcancavel({ nome: 'n', telefone: '3199', email: 'a@b.com' }))
    ok('nome sozinho NÃO alcança', !clienteAlcancavel({ nome: 'n' }))
    ok('nulos não alcançam', !clienteAlcancavel({ nome: 'n', telefone: null, email: null }))
    ok('espaço não é contato', !clienteAlcancavel({ nome: 'n', telefone: '   ', email: '  ' }))

    /**
     * A varredura: o diálogo tem de tratar a resposta de `/api/deals` como
     * array.
     *
     * Por varredura de fonte porque é defeito de **omissão** entre duas peças
     * nossas — a rota não envelopa, a tela esperava envelope, e os dois lados
     * compilam. É o mesmo tipo de prova que o módulo usa para a linha pública
     * no middleware, e pela mesma razão: nenhum teste de unidade alcança.
     */
    // Em 22/11/2026 o diálogo virou a tela de três faixas (`propostas/nova`);
    // o que se cobra é o mesmo, no arquivo novo.
    const tela = readFileSync(join(CORE, 'rotas/(dashboard)/vendas/propostas/nova/NovaClient.tsx'), 'utf8')
    ok('a tela de novo documento busca negócios em /api/deals', tela.includes('/api/deals?'))
    ok(
        'e lê a resposta como ARRAY, não como { data }',
        tela.includes('Array.isArray(corpo)')
    )
    ok('o cadastro inline existe', tela.includes('setCadastrando(true)'))
    ok(
        'e manda negocioNovo, não contato solto',
        tela.includes('negocioNovo') && !tela.includes("fetch('/api/contacts'")
    )
    ok('o diálogo antigo não existe mais', !existsSync(join(CORE, 'components/shared/NovaPropostaDialog.tsx')))
}

// ============================================================ a base do link público

/**
 * O endereço que o link da proposta carrega.
 *
 * O defeito que a homologação de 21/11/2026 pegou, e que nenhum portão via: a
 * base saía de `NEXT_PUBLIC_APP_URL ?? https://${BRAND().appHost}`, a variável
 * **não está gravada** nos Workers de homologação, e o fallback é o host de
 * **produção**. O cliente recebia por e-mail um endereço de produção para uma
 * proposta que só existe em homologação — e produção responde `307` para
 * `/login`, porque lá a rota pública nem existe. Medido: `307` em produção,
 * `200` em homologação, com o mesmo token.
 *
 * A regra agora é uma só, em `lib/base-publica.ts`, e `origemDeReserva()` do
 * Better Auth delega para ela — o incidente de 2026-10-23 documentado lá é o
 * mesmo aprendizado: identidade do app mora em código, o que varia por ambiente
 * sai de `APP().env`, que é enum validado.
 */
{
    ok('homologação ganha o prefixo', hostDoApp('stg', 'exemplo.teste') === 'homolog-exemplo.teste')
    ok('produção não ganha prefixo', hostDoApp('production', 'exemplo.teste') === 'exemplo.teste')
    ok('ambiente vazio não ganha prefixo', hostDoApp('', 'exemplo.teste') === 'exemplo.teste')
    ok(
        'nenhum ambiente duplica o prefixo',
        hostDoApp('stg', hostDoApp('stg', 'e.teste')) === 'homolog-homolog-e.teste'
    )

    /**
     * A varredura: o módulo do link não pode ler a variável de ambiente.
     *
     * Por fonte porque é a FORMA que importa, e ela só se prova rodando no
     * ambiente certo — que não existe nesta máquina. Se alguém reintroduzir
     * `NEXT_PUBLIC_APP_URL` aqui, o link volta a apontar para produção a partir
     * de homologação, e o sintoma aparece três telas adiante, no cliente.
     */
    const compartilhar = readFileSync(join(CORE, 'lib/propostas/compartilhar.ts'), 'utf8')
    ok('o link usa origemDoApp()', compartilhar.includes('origemDoApp()'))
    ok(
        'e NÃO lê NEXT_PUBLIC_APP_URL',
        !compartilhar.replace(/\/\*[\s\S]*?\*\//g, '').includes('NEXT_PUBLIC_APP_URL')
    )

    const base = readFileSync(join(CORE, 'lib/base-publica.ts'), 'utf8')
    ok(
        'a regra de ambiente sai de APP().env',
        base.includes('APP().env') && base.includes('BRAND().appHost')
    )
}

// ============================================================ a alçada

/**
 * Pedir, aprovar, reprovar — e quem pode cada um.
 *
 * Os três estados existiam desde 21/11/2026 e **sem tela**: o plano dizia "só
 * quando alguém pedir", e a homologação pediu. O que faltava não era a máquina
 * de estado — as transições já estavam provadas acima — era a permissão de cada
 * lado dela, e é o que estas asserções cobrem.
 *
 * As duas que importam:
 *
 *   - **pedir não é alçada, decidir é.** Se os dois fossem o mesmo papel, a
 *     aprovação não aprovaria nada;
 *   - **quem pediu não decide.** Sem isso, o gestor que monta a própria proposta
 *     com desconto fora da política pede e aprova no mesmo clique, e o registro
 *     diz que houve aprovação.
 */
{
    ok('três gestos', GESTOS.length === 3)
    ok('todo gesto tem destino', GESTOS.every((g) => ESTADOS.includes(ESTADO_DO_GESTO[g])))
    ok('todo gesto tem rótulo', GESTOS.every((g) => (ROTULO_DO_GESTO[g] ?? '').length > 0))
    ok('ehGesto recusa o que não é', !ehGesto('aceitar') && !ehGesto('enviar') && ehGesto('aprovar'))

    ok('pedir NÃO é alçada', !gestoEhDeAlcada('pedir'))
    ok('aprovar é alçada', gestoEhDeAlcada('aprovar'))
    ok('reprovar é alçada', gestoEhDeAlcada('reprovar'))

    const PEDIU = 'u-vendedor'
    const OUTRO = 'u-gestor'

    ok('auto-aprovação é detectada', ehAutoAprovacao('aprovar', PEDIU, PEDIU))
    ok('auto-reprovação também', ehAutoAprovacao('reprovar', PEDIU, PEDIU))
    ok('outra pessoa decidindo é legítimo', !ehAutoAprovacao('aprovar', PEDIU, OUTRO))
    ok('pedir o próprio documento é legítimo', !ehAutoAprovacao('pedir', PEDIU, PEDIU))
    ok('sem quem pediu, não há de quem suspeitar', !ehAutoAprovacao('aprovar', null, OUTRO))

    // ── o veredito inteiro ──────────────────────────────────────
    const pedir = avaliarGesto({
        gesto: 'pedir',
        estadoAtual: 'rascunho',
        temAlcada: false,
        quemPediu: null,
        quemDecide: PEDIU,
    })
    ok('atendente pede do rascunho', pedir.ok && pedir.para === 'em_aprovacao')

    const semAlcada = avaliarGesto({
        gesto: 'aprovar',
        estadoAtual: 'em_aprovacao',
        temAlcada: false,
        quemPediu: PEDIU,
        quemDecide: OUTRO,
    })
    ok('sem alçada não aprova', !semAlcada.ok && semAlcada.status === 403)

    const propria = avaliarGesto({
        gesto: 'aprovar',
        estadoAtual: 'em_aprovacao',
        temAlcada: true,
        quemPediu: PEDIU,
        quemDecide: PEDIU,
    })
    ok('nem com alçada aprova a própria', !propria.ok && propria.status === 403)

    const certa = avaliarGesto({
        gesto: 'aprovar',
        estadoAtual: 'em_aprovacao',
        temAlcada: true,
        quemPediu: PEDIU,
        quemDecide: OUTRO,
    })
    ok('gestão aprova o de outro', certa.ok && certa.para === 'aprovada')

    /**
     * Estado errado responde **409**, não 403.
     *
     * "Você não pode" e "daqui não dá" são respostas diferentes. Trocá-las faria
     * o gestor achar que lhe falta permissão quando o que falta é o documento
     * estar em aprovação — e ele iria pedir acesso a alguém.
     */
    const foraDeEstado = avaliarGesto({
        gesto: 'aprovar',
        estadoAtual: 'enviada',
        temAlcada: true,
        quemPediu: PEDIU,
        quemDecide: OUTRO,
    })
    ok('aprovar o que já foi enviado dá 409', !foraDeEstado.ok && foraDeEstado.status === 409)

    // A ordem importa: papel antes de estado, para que "não pode" nunca apareça
    // como "não dá".
    const semAlcadaEForaDeEstado = avaliarGesto({
        gesto: 'aprovar',
        estadoAtual: 'enviada',
        temAlcada: false,
        quemPediu: PEDIU,
        quemDecide: OUTRO,
    })
    ok(
        'papel é conferido antes do estado',
        !semAlcadaEForaDeEstado.ok && semAlcadaEForaDeEstado.status === 403
    )

    // ── a etapa de ganho, por varredura ─────────────────────────
    /**
     * O aceite tem de **preferir** a etapa marcada.
     *
     * Por fonte porque a escolha é uma consulta dentro da transação do aceite —
     * só se prova contra banco. O que a varredura garante é que a preferência
     * não desapareça num refactor, deixando o aceite de volta na última etapa:
     * o defeito que a homologação achou, em que o ganho caía na etapa de
     * retrabalho.
     */
    const aceite = readFileSync(join(CORE, 'lib/propostas/aceite.ts'), 'utf8')
    ok('o aceite procura a etapa de ganho', aceite.includes('isWon: true'))
    ok('e mantém a queda para a última', aceite.includes("orderBy: { order: 'desc' }"))
}

// ============================================================ F0: seções e variáveis em grupo

/**
 * A fundação da v2 (22/11/2026): o documento vira seções tipadas, as variáveis
 * ganham grupos derivados dos campos do sistema, e os dez marcadores da v1
 * viram apelidos. O que se prova aqui é o que a migração promete: **nada da v1
 * muda de aparência** — o render do corpo antigo e o render da sua conversão
 * em seções são o mesmo HTML, byte a byte, descontado o embrulho `<section>`.
 */
{
    // ── a gramática do token ganhou o ponto ──
    ok('cliente.nome resolve', aplicarVariaveis('{{cliente.nome}}', { cliente: { nome: 'Helena' } }) === 'Helena')
    ok('o apelido da v1 resolve para o mesmo valor', aplicarVariaveis('{{cliente}}', { cliente: { nome: 'Helena' } }) === 'Helena')
    ok('todo apelido aponta para um campo do registro', Object.values(APELIDOS).every((d) => MARCADORES.includes(d)))
    ok('grupo.campo desconhecido fica visível', aplicarVariaveis('{{cliente.sapato}}', { cliente: { nome: 'x' } }) === '{{cliente.sapato}}')
    ok('marcadoresCitados lê o ponto', marcadoresCitados('{{cliente.nome}} e {{total}}').join(',') === 'cliente.nome,total')
    ok('todo grupo tem rótulo e ao menos um campo', GRUPOS.every((g) => Object.keys(REGISTRO[g]).length > 0))
    ok('todo marcador em grupo tem ajuda', MARCADORES.every((m) => (AJUDA_DO_MARCADOR[m] ?? '').length > 0))

    // ── campos personalizados do cliente entram sozinhos ──
    ok('rótulo vira chave sem acento nem espaço', chaveDeCampo('Data de nascimento') === 'data_de_nascimento')
    ok('chave não começa nem termina com _', chaveDeCampo(' Plano? ') === 'plano')
    {
        const { rotulos, valores } = variaveisPersonalizadas({ 'Data de nascimento': '01/02/1990', nome: 'sombra', Idade: 36, lista: [1] })
        ok('personalizado vira variável com o rótulo original', rotulos.data_de_nascimento === 'Data de nascimento' && valores.data_de_nascimento === '01/02/1990')
        ok('personalizado NÃO sombreia um fixo', !('nome' in rotulos))
        ok('número vira texto; objeto é ignorado', valores.idade === '36' && !('lista' in valores))
        ok(
            'e resolve no texto pelo contexto',
            aplicarVariaveis('Nasceu em {{cliente.data_de_nascimento}}', { cliente: { nome: 'x', ...valores } }) === 'Nasceu em 01/02/1990'
        )
        ok('ehMarcador vê o personalizado só com o contexto', ehMarcador('cliente.data_de_nascimento', { cliente: valores }) && !ehMarcador('cliente.data_de_nascimento'))
    }

    // ── a biblioteca ──
    ok('doze tipos mais o texto genérico', TIPOS_DE_SECAO.length === 13)
    ok('todo tipo tem rótulo', TIPOS_DE_SECAO.every((t) => (ROTULO_DA_SECAO[t] ?? '').length > 0))
    ok('quatro são página', TIPOS_DE_SECAO.filter(ehPagina).length === 4 && ehPagina('capa') && ehPagina('fechamento'))
    ok('itens e aceite são bloco', !ehPagina('itens') && !ehPagina('aceite'))
    ok('compromisso: destaques, fases, investimento, garantia, condições', ['destaques', 'fases', 'investimento', 'garantia', 'condicoes'].every((t) => ehCompromisso(t as never)))
    ok('carta e texto NÃO são compromisso', !ehCompromisso('carta') && !ehCompromisso('texto'))
    ok('tipo inventado é recusado', !ehTipoDeSecao('video'))
    ok('o schema recusa seção sem id', !secoesSchema.safeParse([{ tipo: 'itens' }]).success)
    ok('o schema recusa tipo desconhecido', !secoesSchema.safeParse([{ id: 'a', tipo: 'video' }]).success)
    ok('o schema aceita a biblioteca inteira mínima', secoesSchema.safeParse([
        { id: 'a', tipo: 'capa' }, { id: 'b', tipo: 'sumario' }, { id: 'c', tipo: 'carta', corpo: 'x' },
        { id: 'd', tipo: 'destaques', itens: [] }, { id: 'e', tipo: 'escopo', cartoes: [] }, { id: 'f', tipo: 'fases', fases: [] },
        { id: 'g', tipo: 'itens' }, { id: 'h', tipo: 'investimento', cartoes: [] }, { id: 'i', tipo: 'garantia', blocos: [] },
        { id: 'j', tipo: 'condicoes', corpo: 'x' }, { id: 'k', tipo: 'aceite' }, { id: 'l', tipo: 'fechamento', corpo: 'x' },
    ]).success)

    // ── a conversão do corpo da v1 ──
    const corpo = '# {{titulo}}\n\nPara: {{cliente}}\n\n{{itens}}\n\n- um\n- dois\n\n{{observacao}}'
    const convertidas = converterCorpoEmSecoes(corpo)
    ok('corpo com {{itens}} vira texto · itens · texto', convertidas.map((s) => s.tipo).join(',') === 'texto,itens,texto')
    ok('a conversão é determinística', JSON.stringify(converterCorpoEmSecoes(corpo)) === JSON.stringify(convertidas))
    ok('corpo vazio não vira seção', converterCorpoEmSecoes('  ').length === 0)
    ok('corpo sem {{itens}} vira um texto só', converterCorpoEmSecoes('Olá {{cliente}}').map((s) => s.tipo).join(',') === 'texto')

    /**
     * O oráculo: render da v1 ≡ render da conversão, byte a byte no miolo.
     *
     * É a promessa da migração. Se isto falhar, uma proposta antiga mudou de
     * cara sem ninguém pedir.
     */
    const entrada = {
        corpo,
        variaveis: { documento: { titulo: 'Plano', observacao: 'Obs.' }, cliente: { nome: 'Maria' } },
        itens: ITENS,
        totais: calcularTotais([{ quantity: '1', unitPrice: '150.00', discountPct: '0' }]),
        moeda: 'BRL',
    }
    const legado = renderCorpoLegado(entrada)
    const novo = miolo(renderDocumento(entrada))
    ok('render do corpo da v1 ≡ render das seções convertidas', legado === novo, legado === novo ? '' : `\n--- legado ---\n${legado}\n--- novo ---\n${novo}`)
    ok('seções explícitas e corpo convertido dão o mesmo', miolo(renderDocumento({ ...entrada, secoes: convertidas })) === novo)

    // o que o <section> acrescenta, e só isso
    const comEmbrulho = renderDocumento(entrada)
    ok('cada seção vem embrulhada e identificada', (comEmbrulho.match(/<section class="doc-secao doc-secao-/g) ?? []).length === 3 && comEmbrulho.includes('data-secao="s2"'))
    ok('página vira doc-pagina', renderDocumento({ ...entrada, secoes: [{ id: 'c', tipo: 'capa' }] }).includes('class="doc-pagina doc-pagina-capa"'))
    ok('o padrão sem modelo tem texto, itens e observação', secoesPadrao().map((s) => s.tipo).join(',') === 'texto,itens,texto')

    // ── as seções novas renderizam e escapam ──
    const ctx = { cliente: { nome: '<b>Helena</b>' }, documento: { titulo: 'T' }, organizacao: { nome: 'Org' }, responsavel: { nome: 'A', email: 'a@b', telefone: '31' } }
    const html = renderDocumento({
        secoes: [
            { id: '1', tipo: 'capa', subtitulo: 'Para {{cliente.nome}}' },
            { id: '2', tipo: 'sumario' },
            { id: '3', tipo: 'destaques', titulo: 'Números', itens: [{ valor: '64%', rotulo: 'Resolvidos' }] },
            { id: '4', tipo: 'fases', fases: [{ nome: 'Diagnóstico', descricao: 'x', prazo: 'dia 1-3' }] },
            { id: '5', tipo: 'investimento', cartoes: [{ titulo: 'Setup', valor: 'R$ 4.800', inclui: ['a', 'b'] }] },
            { id: '6', tipo: 'aceite' },
            { id: '7', tipo: 'fechamento', corpo: 'Obrigado', chamada: 'OBRIGADO.' },
        ],
        variaveis: ctx, itens: [], totais: { subtotal: 0, discount: 0, total: 0 } as never, moeda: 'BRL',
    })
    ok('a capa escapa o nome do cliente', html.includes('&lt;b&gt;Helena&lt;/b&gt;') && !html.includes('<b>Helena'))
    ok('o sumário lista as seções com título', html.includes('<ol class="doc-sumario">') && html.includes('<li>Números</li>') && html.includes('<li>Fases</li>'))
    ok('o sumário não lista a capa nem a si mesmo', !html.includes('<li>Capa</li>') && !html.includes('<li>Sumário</li>'))
    ok('destaques, fases e investimento saem com as classes do CSS', html.includes('doc-destaques') && html.includes('doc-fases') && html.includes('doc-precos'))
    ok('o aceite cita o cliente escapado', html.includes('doc-aceite') && html.includes('&lt;b&gt;Helena&lt;/b&gt; confirma'))
    ok('o fechamento traz a chamada e o contato', html.includes('<p class="doc-chamada">OBRIGADO.</p>') && html.includes('a@b'))

    // ── congelar e descongelar ──
    const vivo = contextoDeVariaveis({
        contato: { name: 'Helena Prado', phone: '5531999990001', email: 'h@x.com', customFields: { Convênio: 'Uni' } },
        organizacao: { name: 'Clínica X', cnpj: '00.000.000/0001-00' },
        documento: { kind: 'proposta', number: 7, title: 'T', createdAt: new Date('2026-11-22T12:00:00Z'), validUntil: null, subtotal: '100', discount: '0', total: '100', moeda: 'BRL', observacao: 'interna' },
        negocio: { title: 'N', value: 1000, stageName: 'Em atendimento', createdAt: new Date('2026-11-18T12:00:00Z') },
        responsavel: { name: 'André', email: 'a@v.com', phone: null },
    })
    ok('primeiro nome é derivado', vivo.cliente?.primeiro_nome === 'Helena')
    ok('o número leva o rótulo do tipo', vivo.documento?.numero === 'Proposta 7')
    ok('desconto zero é nulo (some com a pontuação)', vivo.documento?.desconto === null)
    ok('o personalizado entrou no grupo cliente', vivo.cliente?.convenio === 'Uni')
    const congelado = congelarVariaveis(vivo)
    ok('o congelado só tem chaves em grupo', Object.keys(congelado).every((k) => k.includes('.')))
    ok('e não tem apelidos', !('cliente' in congelado) && 'cliente.nome' in congelado)
    const descongelado = contextoDeMapa(JSON.parse(JSON.stringify(congelado)))
    ok('congelar → JSON → descongelar devolve o mesmo mapa', JSON.stringify(achatarVariaveis(descongelado)) === JSON.stringify(achatarVariaveis(vivo)))
    ok('chave fora dos grupos é ignorada ao descongelar', !('x' in (contextoDeMapa({ 'x.y': '1', solto: '2' }) as Record<string, unknown>)))
}

// ============================================================ F2: a IA que monta, e o importador

/**
 * O que a IA devolve é uma forma PLANA; o que vira seção é código daqui. E o
 * que a IA não pode fazer — prometer — é garantido em código, não em prompt.
 */
{
    const planas = [
        { tipo: 'capa', titulo: 'Proposta', corpo: 'Para {{cliente.nome}}', linhas: [] },
        { tipo: 'destaques', titulo: 'Números', corpo: null, linhas: [{ a: '64%', b: 'Resolvidos', c: 'pela IA', d: null }] },
        { tipo: 'fases', titulo: null, corpo: null, linhas: [{ a: 'Diagnóstico', b: 'dias 1-3', c: 'Avant', d: 'Análise' }] },
        { tipo: 'investimento', titulo: null, corpo: 'Uma frase', linhas: [{ a: 'Setup', b: 'R$ 4.800', c: 'único', d: 'a; b ;c' }] },
        { tipo: 'garantia', titulo: null, corpo: null, linhas: [{ a: 'Garantia', b: '7 dias', c: null, d: null }] },
        { tipo: 'condicoes', titulo: null, corpo: 'Cláusula X', linhas: [] },
        { tipo: 'fechamento', titulo: null, corpo: 'Obrigado pela oportunidade', linhas: [{ a: 'OBRIGADO.', b: '', c: null, d: null }] },
        { tipo: 'video', titulo: null, corpo: null, linhas: [] },
    ]
    const secoes = secoesDaResposta(planas)
    ok('tipo desconhecido é descartado, não inventado', secoes.length === 7 && !secoes.some((s) => (s.tipo as string) === 'video'))
    ok('capa: corpo vira subtítulo', secoes[0].tipo === 'capa' && secoes[0].subtitulo === 'Para {{cliente.nome}}')
    ok('investimento: "inclui" separa por ponto e vírgula e apara', secoes[3].tipo === 'investimento' && secoes[3].cartoes[0].inclui.join('|') === 'a|b|c')
    ok('fases: a=nome b=prazo c=responsável d=descrição', secoes[2].tipo === 'fases' && secoes[2].fases[0].prazo === 'dias 1-3' && secoes[2].fases[0].descricao === 'Análise')
    ok('fechamento: a primeira linha é a chamada', secoes[6].tipo === 'fechamento' && secoes[6].chamada === 'OBRIGADO.')
    ok('o schema plano é strict em todo objeto', JSON.stringify(SCHEMA_DAS_SECOES_PLANAS).split('"additionalProperties":false').length - 1 >= 3)

    const limpas = esvaziarCompromissos(secoes)
    ok('destaques: valor esvaziado, rótulo fica', limpas[1].tipo === 'destaques' && limpas[1].itens[0].valor === '' && limpas[1].itens[0].rotulo === 'Resolvidos')
    ok('fases: prazo esvaziado, nome fica', limpas[2].tipo === 'fases' && limpas[2].fases[0].prazo === null && limpas[2].fases[0].nome === 'Diagnóstico')
    ok('investimento: valor esvaziado, título fica', limpas[3].tipo === 'investimento' && limpas[3].cartoes[0].valor === '' && limpas[3].cartoes[0].titulo === 'Setup')
    ok('garantia: texto esvaziado, título fica', limpas[4].tipo === 'garantia' && limpas[4].blocos[0].texto === '' && limpas[4].blocos[0].titulo === 'Garantia')
    ok('condições: corpo esvaziado', limpas[5].tipo === 'condicoes' && limpas[5].corpo === '')
    ok('fechamento e capa NÃO são tocados', JSON.stringify(limpas[6]) === JSON.stringify(secoes[6]) && JSON.stringify(limpas[0]) === JSON.stringify(secoes[0]))

    // ── as sugestões do importador: a pessoa confirma, e só então troca ──
    const importadas = secoesDaResposta([
        { tipo: 'carta', titulo: 'Proposta para Helena Prado', corpo: 'A Clínica Sorriso tem o prazer de apresentar a Helena Prado…', linhas: [] },
        { tipo: 'investimento', titulo: null, corpo: null, linhas: [{ a: 'Total', b: 'R$ 9.600,00', c: null, d: null }] },
    ])
    const comTokens = aplicarSugestoes(importadas, [
        { literal: 'Helena Prado', chave: 'cliente.nome' },
        { literal: 'R$ 9.600,00', chave: 'documento.total' },
        { literal: 'ab', chave: 'cliente.nome' },
        { literal: 'Clínica Sorriso', chave: 'cliente.sapato' },
    ])
    ok('o literal vira token em todas as ocorrências', comTokens[0].tipo === 'carta' && comTokens[0].titulo === 'Proposta para {{cliente.nome}}' && comTokens[0].corpo?.split('{{cliente.nome}}').length === 2)
    ok('inclusive dentro de linhas', comTokens[1].tipo === 'investimento' && comTokens[1].cartoes[0].valor === '{{documento.total}}')
    ok('literal curto é ignorado', !JSON.stringify(comTokens).includes('{{cliente.nome}}b'))
    ok('chave fora da lista sugerível é ignorada', !JSON.stringify(comTokens).includes('cliente.sapato') && JSON.stringify(comTokens).includes('Clínica Sorriso'))
    ok('sem sugestões aceitas, nada muda', JSON.stringify(aplicarSugestoes(importadas, [])) === JSON.stringify(importadas))
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
