/**
 * Prova as contas dos relatórios, sem banco.
 *
 *     pnpm run check:relatorios
 *
 * ## Por que estas contas merecem teste e os gráficos não
 *
 * Uma média sobre o denominador errado **não falha**. Ela devolve um número
 * plausível, a clínica decide com ele, e ninguém descobre — não há exceção, não
 * há log, não há tela em branco. É a classe de defeito mais cara que um
 * relatório pode ter, e a única defesa é afirmar a conta contra um caso cujo
 * resultado se sabe de cabeça.
 *
 * Os três eixos que este arquivo guarda, e que são decisões, não detalhes:
 *
 *   - **denominador vazio devolve `null`, não zero** — porque "não há taxa" e
 *     "a taxa é 0%" são informações opostas, e zerar as duas juntas é o
 *     "dashboard que mostra zeros" de que o estudo do Ploomes avisa;
 *   - **a taxa de aceite exclui o que ainda está em jogo** — senão ela cai
 *     sempre que o vendedor trabalha mais;
 *   - **nunca se soma entre moedas** — o resultado não é dinheiro nenhum.
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
    media,
    mediana,
    metricasDeEtapas,
    metricasDePerdas,
    metricasDeProdutos,
    metricasDePropostas,
    proporcao,
    somarPorMoeda,
    type ItemParaMetrica,
    type PassagemParaMetrica,
    type PropostaParaMetrica,
} from '@venn/core/lib/relatorios/metricas'

let falhas = 0
const ok = (nome: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!cond) falhas++
}

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core', 'src')
const ler = (caminho: string) => readFileSync(join(CORE, caminho), 'utf8')

const dia = (n: number) => new Date(Date.UTC(2026, 10, n, 12, 0, 0))

// ============================================== as primitivas

console.log('\n── as primitivas ──')

ok('mediana de lista vazia é null', mediana([]) === null)
ok('mediana de ímpar é o do meio', mediana([1, 100, 2]) === 2)
ok('mediana de par é a média dos dois centrais', mediana([1, 2, 3, 4]) === 2.5)
ok('média de lista vazia é null', media([]) === null)
ok('média simples', media([2, 4]) === 3)

{
    /**
     * A diferença entre mediana e média, com o caso que motivou a escolha.
     *
     * Nove propostas aceitas em dois dias e uma em noventa — o cliente que
     * sumiu e voltou. A média diz 10,8 dias e a mediana diz 2. Quem lê "o
     * cliente costuma levar 11 dias" planeja o follow-up errado.
     */
    const amostra = [2, 2, 2, 2, 2, 2, 2, 2, 2, 90]
    ok('a mediana resiste ao outlier', mediana(amostra) === 2, `mediana=${mediana(amostra)}`)
    ok('a média não resiste', media(amostra) === 10.8, `média=${media(amostra)}`)
}

ok('proporção com denominador zero é null', proporcao(0, 0) === null)
ok('proporção com parte zero é 0, não null', proporcao(0, 10) === 0)
ok('proporção simples', proporcao(1, 4) === 25)

// ============================================== moeda

console.log('\n── nunca somar entre moedas ──')

{
    const soma = somarPorMoeda([
        { moeda: 'BRL', valor: 100 },
        { moeda: 'USD', valor: 50 },
        { moeda: 'BRL', valor: 200 },
    ])
    ok('devolve uma linha por moeda', soma.length === 2, `${soma.length} linhas`)
    ok('BRL soma 300', soma.find((s) => s.moeda === 'BRL')?.total === 300)
    ok('USD fica em 50, não some no total', soma.find((s) => s.moeda === 'USD')?.total === 50)
    /**
     * Se este teste falhar, alguém somou 100 + 50 + 200 e devolveu 350 — um
     * número que não é dinheiro nenhum, e que a tela mostraria com o símbolo de
     * uma das duas moedas.
     */
    ok('nenhuma linha carrega o total das outras', !soma.some((s) => s.total === 350))
    ok('a maior moeda encabeça', soma[0].moeda === 'BRL')
    ok('conta quantos registros compõem cada linha', soma.find((s) => s.moeda === 'BRL')?.quantos === 2)
    ok('lista vazia devolve lista vazia', somarPorMoeda([]).length === 0)
}

// ============================================== propostas

console.log('\n── propostas ──')

{
    // A clínica que ainda não mandou proposta nenhuma.
    const m = metricasDePropostas([])
    ok('sem propostas, quantas = 0', m.quantas === 0)
    /**
     * E as TAXAS são `null`, não 0%.
     *
     * Este é o teste que impede o relatório de dizer "taxa de aceite: 0%" para
     * quem acabou de instalar o produto — a frase que faz o gestor concluir que
     * o funil está parado quando ele nem começou.
     */
    ok('sem propostas, a taxa de aceite é null (não 0%)', m.taxaDeAceite === null)
    ok('sem propostas, o tempo até o aceite é null', m.diasAteAceiteMediana === null)
    ok('sem propostas, a taxa de nunca abertas é null', m.taxaDeNuncaAbertas === null)
    ok('sem propostas, não há valor em moeda nenhuma', m.valorAceito.length === 0)
}

{
    const propostas: PropostaParaMetrica[] = [
        // aceita em 2 dias, 1 versão, 3 aberturas
        { moeda: 'BRL', valor: 1000, estado: 'aceita', versoes: 1, enviadaEm: dia(1), aceitaEm: dia(3), aberturas: 3 },
        // aceita em 10 dias, 3 versões, 5 aberturas
        { moeda: 'BRL', valor: 2000, estado: 'aceita', versoes: 3, enviadaEm: dia(1), aceitaEm: dia(11), aberturas: 5 },
        // recusada
        { moeda: 'BRL', valor: 500, estado: 'recusada', versoes: 1, enviadaEm: dia(2), aceitaEm: null, aberturas: 2 },
        // expirada, e NUNCA aberta
        { moeda: 'BRL', valor: 700, estado: 'expirada', versoes: 1, enviadaEm: dia(2), aceitaEm: null, aberturas: 0 },
        // enviada e ainda em jogo
        { moeda: 'BRL', valor: 900, estado: 'enviada', versoes: 1, enviadaEm: dia(5), aceitaEm: null, aberturas: 1 },
        // rascunho: nunca foi enviada
        { moeda: 'BRL', valor: 300, estado: 'rascunho', versoes: 1, enviadaEm: null, aceitaEm: null, aberturas: 0 },
    ]
    const m = metricasDePropostas(propostas)

    ok('conta todas as propostas', m.quantas === 6)
    /**
     * "Enviada" é ter sido compartilhada, não estar no estado `enviada`.
     *
     * São cinco: as duas aceitas, a recusada, a expirada e a em jogo. A
     * rascunho não. Se o código filtrasse por `estado === 'enviada'`, a conta
     * daria 1 e esqueceria justamente as que deram certo.
     */
    ok('enviadas = as que têm data de compartilhamento', m.enviadas === 5, `${m.enviadas}`)
    ok('aceitas = 2', m.aceitas === 2)
    ok('em aberto = 1 (só a que ainda está em jogo)', m.emAberto === 1)
    ok('o rascunho não entra em "em aberto"', m.emAberto === 1)

    /**
     * A taxa de aceite é 2 de 4 DECIDIDAS = 50%.
     *
     * Não 2 de 5 enviadas (40%) e não 2 de 6 (33%). A proposta de dia 5, dentro
     * do prazo, não é uma derrota — contá-la como tal faria a taxa piorar
     * sempre que o vendedor mandasse mais propostas.
     */
    ok('taxa de aceite = 50% (sobre as decididas)', m.taxaDeAceite === 50, `${m.taxaDeAceite}%`)
    ok('e NÃO é 40% (sobre as enviadas)', m.taxaDeAceite !== 40)

    ok('mediana de dias até o aceite = 6', m.diasAteAceiteMediana === 6, `${m.diasAteAceiteMediana}`)
    ok('média de dias até o aceite = 6', m.diasAteAceiteMedia === 6)
    ok('versões até o aceite = 2 em média', m.versoesAteAceiteMedia === 2)

    /**
     * O dado de ouro: enviada e nunca aberta.
     *
     * Uma das cinco. Zero abertura num documento enviado não é "ele não gostou"
     * — é "ele não abriu", e a ação seguinte é outra.
     */
    ok('nunca abertas = 1', m.nuncaAbertas === 1)
    ok('taxa de nunca abertas = 20%', m.taxaDeNuncaAbertas === 20, `${m.taxaDeNuncaAbertas}%`)
    ok('aberturas por proposta = 2.2 em média', m.aberturasPorPropostaMedia === 2.2, `${m.aberturasPorPropostaMedia}`)

    ok('valor aceito = 3000 em BRL', m.valorAceito[0]?.total === 3000 && m.valorAceito[0]?.moeda === 'BRL')
    ok('valor em aberto = 900 (só o que está em jogo)', m.valorEmAberto[0]?.total === 900)
    /** O recusado e o expirado NÃO entram em "em aberto" nem em "aceito". */
    ok('o recusado não entra em nenhum dos dois valores', m.valorAceito[0].total === 3000 && m.valorEmAberto[0].total === 900)
}

{
    // Multimoeda: o relatório quebra por moeda em vez de somar.
    const m = metricasDePropostas([
        { moeda: 'BRL', valor: 1000, estado: 'aceita', versoes: 1, enviadaEm: dia(1), aceitaEm: dia(2), aberturas: 1 },
        { moeda: 'USD', valor: 500, estado: 'aceita', versoes: 1, enviadaEm: dia(1), aceitaEm: dia(2), aberturas: 1 },
    ])
    ok('valor aceito sai em duas linhas', m.valorAceito.length === 2)
    ok('e nenhuma delas é 1500', !m.valorAceito.some((v) => v.total === 1500))
}

{
    // Data de aceite anterior ao envio: descartada em vez de virar "-3 dias".
    const m = metricasDePropostas([
        { moeda: 'BRL', valor: 100, estado: 'aceita', versoes: 1, enviadaEm: dia(10), aceitaEm: dia(7), aberturas: 1 },
    ])
    ok('aceite antes do envio não produz dias negativos', m.diasAteAceiteMediana === null)
}

// ============================================== produtos

console.log('\n── produtos: o que vende ──')

{
    const itens: ItemParaMetrica[] = [
        { productServiceId: 'p1', descricao: 'Clareamento', quantidade: 2, total: 800, moeda: 'BRL', estadoDaRevisao: 'aceita' },
        { productServiceId: 'p1', descricao: 'Clareamento', quantidade: 1, total: 400, moeda: 'BRL', estadoDaRevisao: 'aceita' },
        { productServiceId: 'p1', descricao: 'Clareamento', quantidade: 1, total: 400, moeda: 'BRL', estadoDaRevisao: 'recusada' },
        { productServiceId: 'p2', descricao: 'Avaliação', quantidade: 1, total: 150, moeda: 'BRL', estadoDaRevisao: 'enviada' },
        // linha escrita à mão, sem item de catálogo
        { productServiceId: null, descricao: 'Deslocamento', quantidade: 1, total: 50, moeda: 'BRL', estadoDaRevisao: 'aceita' },
    ]
    const linhas = metricasDeProdutos(itens)

    const clareamento = linhas.find((l) => l.productServiceId === 'p1')
    ok('agrupa pelo item do catálogo', clareamento !== undefined)
    ok('conta em quantas propostas apareceu', clareamento?.propostas === 3)
    ok('soma a quantidade', clareamento?.quantidade === 4)
    /**
     * **A receita conta só o aceito.**
     *
     * 800 + 400 das aceitas = 1200. A recusada de 400 não entra: somá-la daria
     * uma receita que não entrou, e que cresceria quando o vendedor mandasse
     * mais propostas sem fechar nenhuma.
     */
    ok('receita = 1200 (só o aceito)', clareamento?.receita[0]?.total === 1200, `${clareamento?.receita[0]?.total}`)
    ok('e NÃO 1600 (o recusado fora)', clareamento?.receita[0]?.total !== 1600)
    ok('taxa de aceite do item = 66.67% (2 de 3 decididas)', clareamento?.taxaDeAceite === 66.67, `${clareamento?.taxaDeAceite}%`)

    const avaliacao = linhas.find((l) => l.productServiceId === 'p2')
    ok('item só em proposta em aberto aparece na lista', avaliacao !== undefined)
    ok('mas sem receita', avaliacao?.receita.length === 0)
    /** Sem nada decidido, a taxa é `null` — não 0%. */
    ok('e com taxa null, não 0%', avaliacao?.taxaDeAceite === null)

    const deslocamento = linhas.find((l) => l.descricao === 'Deslocamento')
    ok('linha escrita à mão não é descartada', deslocamento !== undefined)
    ok('e é agrupada pela descrição', deslocamento?.productServiceId === null)

    ok('a maior receita encabeça', linhas[0].productServiceId === 'p1')
}

{
    /**
     * A ordenação é ESTÁVEL entre duas chamadas.
     *
     * Itens de receita zero são muitos, e sem desempate a ordem vinha da ordem
     * de inserção no `Map` — a lista mudava entre duas aberturas da mesma tela
     * sem nada ter mudado, e o gestor acha que viu outro dado.
     */
    const zerados: ItemParaMetrica[] = ['c', 'a', 'b'].map((d) => ({
        productServiceId: null,
        descricao: d,
        quantidade: 1,
        total: 100,
        moeda: 'BRL',
        estadoDaRevisao: 'enviada',
    }))
    const uma = metricasDeProdutos(zerados).map((l) => l.descricao).join(',')
    const outra = metricasDeProdutos([...zerados].reverse()).map((l) => l.descricao).join(',')
    ok('a ordem não depende da ordem de entrada', uma === outra, `${uma} vs ${outra}`)
}

// ============================================== funil

console.log('\n── funil: tempo por etapa ──')

{
    const passagens: PassagemParaMetrica[] = [
        // negócio 1: entra em Contato (dia 1), vai para Proposta (dia 3), fecha em Ganho (dia 10)
        { dealId: 'd1', stageId: 's1', stageName: 'Contato', stageOrder: 0, entrouEm: dia(1) },
        { dealId: 'd1', stageId: 's2', stageName: 'Proposta', stageOrder: 1, entrouEm: dia(3) },
        { dealId: 'd1', stageId: 's3', stageName: 'Ganho', stageOrder: 2, entrouEm: dia(10) },
        // negócio 2: Contato (dia 1) -> Proposta (dia 5), e PARA LÁ (ainda está nela)
        { dealId: 'd2', stageId: 's1', stageName: 'Contato', stageOrder: 0, entrouEm: dia(1) },
        { dealId: 'd2', stageId: 's2', stageName: 'Proposta', stageOrder: 1, entrouEm: dia(5) },
    ]
    const linhas = metricasDeEtapas(passagens)

    ok('uma linha por etapa', linhas.length === 3)
    ok('na ordem do funil, não da contagem', linhas.map((l) => l.nome).join(',') === 'Contato,Proposta,Ganho')

    const contato = linhas.find((l) => l.nome === 'Contato')
    ok('Contato: dois negócios passaram', contato?.passaram === 2)
    ok('Contato: mediana de 3 dias (2 e 4)', contato?.diasMediana === 3, `${contato?.diasMediana}`)

    const proposta = linhas.find((l) => l.nome === 'Proposta')
    /**
     * **A última passagem de cada negócio não conta.**
     *
     * O negócio 2 ainda está em Proposta; medir "até agora" misturaria tempo
     * decorrido com tempo gasto. Então só o negócio 1 entra: 7 dias.
     */
    ok('Proposta: só o negócio que SAIU entra na conta', proposta?.diasMediana === 7, `${proposta?.diasMediana}`)
    ok('mas os dois contam em "passaram"', proposta?.passaram === 2)

    const ganho = linhas.find((l) => l.nome === 'Ganho')
    ok('a etapa final aparece, sem tempo', ganho?.passaram === 1 && ganho?.diasMediana === null)
}

{
    ok('funil sem passagem nenhuma devolve lista vazia', metricasDeEtapas([]).length === 0)
}

console.log('\n── funil: onde vaza ──')

{
    const linhas = metricasDePerdas([
        { closedStageId: 's2', closedStageName: 'Proposta', motivo: 'Preço', moeda: 'BRL', valor: 1000 },
        { closedStageId: 's2', closedStageName: 'Proposta', motivo: 'Preço', moeda: 'BRL', valor: 500 },
        { closedStageId: 's2', closedStageName: 'Proposta', motivo: 'Prazo', moeda: 'BRL', valor: 300 },
        { closedStageId: 's1', closedStageName: 'Contato', motivo: null, moeda: 'BRL', valor: 100 },
        // negócio anterior ao `closedStageId` existir
        { closedStageId: null, closedStageName: null, motivo: 'Preço', moeda: 'BRL', valor: 200 },
    ])

    const proposta = linhas.find((l) => l.nome === 'Proposta')
    ok('agrupa pela etapa de fechamento', proposta?.perdidos === 3)
    ok('soma o valor que saiu por ali', proposta?.valor[0]?.total === 1800)
    ok('o motivo mais frequente encabeça', proposta?.motivos[0]?.nome === 'Preço' && proposta?.motivos[0]?.quantos === 2)

    const contato = linhas.find((l) => l.nome === 'Contato')
    ok('perda sem motivo não é descartada', contato?.perdidos === 1)
    ok('e aparece como "Sem motivo informado"', contato?.motivos[0]?.nome === 'Sem motivo informado')

    /**
     * Negócio fechado antes de `closedStageId` existir não é escondido.
     *
     * Ele faz parte do total; omiti-lo faria a soma do relatório não bater com o
     * número de perdidos do funil.
     */
    const semEtapa = linhas.find((l) => l.nome === 'Etapa não registrada')
    ok('fechado sem etapa aparece, nomeado', semEtapa?.perdidos === 1)

    const total = linhas.reduce((s, l) => s + l.perdidos, 0)
    ok('a soma das linhas é o total de perdidos', total === 5, `${total}`)
}

// ============================================== os portões

console.log('\n── o portão está nas TRÊS superfícies ──')

{
    /**
     * Esconder do menu não é autorização, e exportar é o jeito mais fácil de
     * contornar uma tela.
     *
     * Um relatório tem três portas — a tela, o JSON e o CSV — e cada uma precisa
     * do seu próprio teste de papel. A lição é recente e custou um commit no
     * módulo de documentos: `/p/<token>` ficou atrás do login porque a linha
     * dela faltava numa lista, e **nenhuma prova local podia ver**, porque
     * nenhuma atravessa o middleware. Aqui a defesa é a mesma técnica —
     * varredura do fonte, para um defeito de OMISSÃO.
     *
     * Se este teste falhar, um atendente consegue o número agregado da operação
     * inteira pedindo a URL direto, e a tela dele continua limpa.
     */
    const superficies: [string, string][] = [
        ['a tela', 'rotas/(dashboard)/relatorios/page.tsx'],
        ['a rota de JSON', 'rotas/api/relatorios/route.ts'],
        ['a rota de CSV', 'rotas/api/relatorios/export/route.ts'],
    ]

    for (const [nome, caminho] of superficies) {
        const fonte = ler(caminho)
        ok(`${nome} exige OVERSIGHT_ROLES`, fonte.includes('OVERSIGHT_ROLES'))
    }

    /**
     * E o recorte de DADO é independente do portão de papel.
     *
     * `dealScope` é aplicado dentro de `relatorioDe*`, não na rota: se amanhã o
     * atendente ganhar uma visão própria, ela já nasce recortada. Dois portões,
     * e o segundo não depende do primeiro.
     */
    const consultas = ler('lib/relatorios/consultas.ts')
    ok('o recorte de dado vem de dealScope', consultas.includes('dealScope(membro)'))
    ok(
        'e pedir uma pessoa ESTREITA o recorte, nunca alarga',
        consultas.includes('AND: [base, { userId: pedido }]')
    )

    // A exportação chama a MESMA consulta da tela: duas consultas divergiriam, e
    // a planilha passaria a discordar do número que o gestor viu.
    const csv = ler('rotas/api/relatorios/export/route.ts')
    ok(
        'o CSV reusa as consultas da tela',
        csv.includes('relatorioDePropostas') &&
            csv.includes('relatorioDeProdutos') &&
            csv.includes('relatorioDeFunil')
    )
    // E o CSV neutraliza fórmula, porque o alvo do ataque é o Excel de quem
    // exporta — não o nosso sistema.
    const libCsv = ler('lib/relatorios/csv.ts')
    ok('o CSV passa por escapeCsv (neutraliza fórmula)', libCsv.includes('escapeCsv'))
}

// ============================================== fecho

console.log('')
if (falhas > 0) {
    console.log(`${falhas} FALHA(S)`)
    process.exitCode = 1
} else {
    console.log('tudo passou')
}
