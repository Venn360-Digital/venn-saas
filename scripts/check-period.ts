/**
 * As contas que erram calado.
 *
 * O projeto não tem suíte de testes, e esta é a parte do código onde um erro não
 * aparece na tela: a semana que começa num dia errado, fevereiro com 28 dias num
 * ano bissexto, o `toISOString()` que empurra o dia no fuso de São Paulo, e o
 * atendente que recebe o recorte de outra pessoa por pedir na URL.
 *
 * `npm run check:period`
 */
// PRIMEIRO de todos: registra uma marca fictícia, porque este script roda
// código do core e o core PEDE a marca. Ver `./lib/marca-de-teste.ts`.
import './lib/marca-de-teste.ts'

import { periodRange, matchPreset, resolvePeriodParams, isoDay } from '@venn/core/lib/period'
import { resolveOwnerScope, canSeeEveryone, conversationScope, type WorkspaceRole } from '@venn/core/lib/auth/workspace'
import {
    limitesEfetivos,
    tetoDeUnidades,
    PRECO_ADICIONAL,
    PLAN_PRICES,
    economiaDoAnual,
    mensalEquivalente,
    precoDoTreinamento,
    treinamentoIncluido,
    valorDaFatura,
} from '@venn/core/lib/plan-limits'
import { conferirCobranca, cobrancaCompleta, listarFaltantes } from '@venn/core/lib/billing/dados-de-cobranca'
import { carenciaEmDias, fimDaCarencia, carenciaVencida } from '@venn/core/lib/billing/inadimplencia'
import {
    diferencaDeContrato,
    diferencaProporcional,
    direcaoDaTroca,
    direcaoDoContrato,
    inicioDaCobranca,
    mensalidade,
    proporcionalDoAdicional,
    proximaCobranca,
} from '@venn/core/lib/billing/troca-de-plano'

let fails = 0
function eq(label: string, got: unknown, want: unknown) {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) fails++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`)
}

// Três âncoras na mesma semana de outubro de 2026, para pegar as bordas do
// domingo: 11/10 é domingo, 10/10 é o sábado anterior, 14/10 é a quarta.
const sat = new Date(2026, 9, 10, 15, 0).getTime()   // sábado
const sun = new Date(2026, 9, 11, 15, 0).getTime()   // domingo
const wed = new Date(2026, 9, 14, 9, 30).getTime()   // quarta

console.log('— atalhos de período')
eq('Hoje é um dia só', periodRange('today', wed), { from: '2026-10-14', to: '2026-10-14' })
eq('Esta semana começa no domingo', periodRange('week', wed), { from: '2026-10-11', to: '2026-10-17' })
eq('No próprio domingo a semana começa nele', periodRange('week', sun), { from: '2026-10-11', to: '2026-10-17' })
eq('No sábado a semana é a que termina nele', periodRange('week', sat), { from: '2026-10-04', to: '2026-10-10' })
eq('Este mês vai do dia 1 ao último', periodRange('month', wed), { from: '2026-10-01', to: '2026-10-31' })
eq('Fevereiro de ano bissexto', periodRange('month', new Date(2028, 1, 10).getTime()), { from: '2028-02-01', to: '2028-02-29' })
eq('Últimos 7 dias incluem hoje', periodRange('d7', wed), { from: '2026-10-08', to: '2026-10-14' })
eq('Últimos 30 dias atravessam o mês', periodRange('d30', wed), { from: '2026-09-15', to: '2026-10-14' })
eq('Últimos 90 dias', periodRange('d90', wed), { from: '2026-07-17', to: '2026-10-14' })

console.log('\n— o rótulo reconhece o atalho de volta')
eq('mês', matchPreset('2026-10-01', '2026-10-31', wed), 'month')
eq('semana', matchPreset('2026-10-11', '2026-10-17', wed), 'week')
eq('intervalo digitado não é atalho', matchPreset('2026-10-03', '2026-10-09', wed), null)
eq('sem data não é atalho', matchPreset('', '', wed), null)

console.log('\n— o que a URL manda')
eq('sem nada, o padrão da tela', resolvePeriodParams({}, 'month', wed), { from: '2026-10-01', to: '2026-10-31', preset: 'month' })
eq('period=all é "todo o período"', resolvePeriodParams({ period: 'all' }, 'month', wed), { from: '', to: '', preset: null })
eq('datas na URL ganham do padrão', resolvePeriodParams({ from: '2026-01-01', to: '2026-01-31' }, 'month', wed), { from: '2026-01-01', to: '2026-01-31', preset: null })
eq('só o começo', resolvePeriodParams({ from: '2026-01-01' }, 'week', wed), { from: '2026-01-01', to: '', preset: null })
eq('padrão da Agenda é a semana', resolvePeriodParams({}, 'week', wed), { from: '2026-10-11', to: '2026-10-17', preset: 'week' })

// A dica que impede o rótulo de piscar: o recorte que veio da URL e por acaso
// é um atalho precisa ser reconhecido como tal, senão o botão mostra as datas.
eq('intervalo da URL que coincide com o mês', resolvePeriodParams({ from: '2026-10-01', to: '2026-10-31' }, 'week', wed), { from: '2026-10-01', to: '2026-10-31', preset: 'month' })

console.log('\n— isoDay não empurra o dia no fuso de São Paulo')
/**
 * O instante é construído com **deslocamento explícito**, não por componentes.
 *
 * `new Date(2026, 9, 14, 0, 0, 0)` é meia-noite **no fuso da máquina**. Em
 * −03 isso é 03:00 UTC e o dia bate; num runner em UTC é 21:00 do dia
 * anterior em Brasília, e o mesmo teste reprova. Foi o que aconteceu ao ligar
 * este verificador ao CI em 2026-10-24: ele passava há meses na máquina do
 * André e **nunca tinha rodado em UTC**.
 *
 * A ironia é que o teste existe justamente para provar que `isoDay` não
 * empurra o dia — e a entrada dele dependia do fuso da máquina. Um teste de
 * fuso que só vale num fuso não prova nada.
 */
eq('meia-noite em São Paulo', isoDay(new Date('2026-10-14T00:00:00-03:00')), '2026-10-14')
eq('23h59 em São Paulo', isoDay(new Date('2026-10-14T23:59:59-03:00')), '2026-10-14')
// E a borda que separa os dois dias: 03:00 UTC é meia-noite em Brasília.
eq('02h59 UTC ainda é dia 13', isoDay(new Date('2026-10-14T02:59:59Z')), '2026-10-13')
eq('03h00 UTC já é dia 14', isoDay(new Date('2026-10-14T03:00:00Z')), '2026-10-14')

console.log('\n— quem vê o quê')
const member = (role: WorkspaceRole, departmentIds: string[] = []) => ({
    membershipId: 'm', userId: 'eu', workspaceId: 'w', role, departmentIds, canTransfer: false,
    // Nenhuma das duas participa do recorte que este script prova; existem
    // porque o tipo é o mesmo do runtime, e é bom que seja.
    status: 'ausente', recebeConversas: false, ultimaAtividadeEm: null,
    minutosParaAusente: null,
})
for (const role of ['OWNER', 'ADMIN', 'GESTOR'] as WorkspaceRole[]) {
    eq(`${role} pode escolher`, canSeeEveryone(role), true)
    eq(`${role} pedindo todos`, resolveOwnerScope(member(role), 'all'), null)
    eq(`${role} sem pedir nada vê todos`, resolveOwnerScope(member(role), null), null)
    eq(`${role} pedindo outra pessoa`, resolveOwnerScope(member(role), 'outra'), 'outra')
}
eq('ATENDENTE não pode escolher', canSeeEveryone('ATENDENTE'), false)
eq('ATENDENTE pedindo todos recebe a si mesmo', resolveOwnerScope(member('ATENDENTE'), 'all'), 'eu')
eq('ATENDENTE pedindo outra pessoa recebe a si mesmo', resolveOwnerScope(member('ATENDENTE'), 'outra'), 'eu')
eq('ATENDENTE sem pedir nada recebe a si mesmo', resolveOwnerScope(member('ATENDENTE'), null), 'eu')

/**
 * O recorte de fila, que é a outra conta que erra calado.
 *
 * Um erro aqui não dá tela de erro: dá alguém vendo conversa que não é da fila
 * dele — ou, pior, **não** dando sintoma nenhum, porque errar para o lado de
 * mostrar demais ninguém reclama.
 *
 * `filaGeral` é o que todo mundo vê sempre: linha sem departamento e conversa
 * sem linha não são de ninguém em particular.
 */
console.log('\n— recorte de conversa por departamento')

const filaGeral = [
    { integration: { departmentId: null } },
    { integrationId: null },
]
/**
 * A conversa em que eu **colaboro** entra no recorte mesmo fora da minha fila.
 *
 * É a única cláusula deste recorte que *abre*, e por isso ela é afirmada aqui
 * em vez de ficar implícita: se um dia alguém a remover para "simplificar", a
 * colega marcada na nota deixa de ver a conversa e o item 6 morre em silêncio —
 * o recado continua chegando com o link, e o link não abre nada.
 */
const queEuColaboro = { collaborators: { some: { userId: 'eu' } } }
const comFilas = (ids: string[]) => ({
    AND: [
        {
            OR: [
                { integration: { departmentId: { in: ids } } },
                ...filaGeral,
                queEuColaboro,
            ],
        },
    ],
})

for (const role of ['OWNER', 'ADMIN', 'GESTOR'] as WorkspaceRole[]) {
    eq(`${role} não é recortado`, conversationScope(member(role, ['comercial'])), {})
}

eq(
    'atendente vê as filas dos departamentos dele',
    conversationScope(member('ATENDENTE', ['comercial', 'recepcao'])),
    comFilas(['comercial', 'recepcao'])
)

// O fail-closed: `in []` não casa com nada, então sobra a fila geral. Antes
// este caso devolvia `{}` — "vê tudo" — e era o buraco: a clínica criava
// departamentos, esquecia de atribuir alguém, e essa pessoa seguia lendo todas
// as filas sem que nada apontasse para isso.
//
// É também a neutralização que dispensa um parâmetro de "usar departamentos":
// numa clínica sem departamento nenhum, toda linha tem `departmentId` nulo, e
// então esta mesma fórmula casa com todas as conversas.
eq(
    'atendente sem departamento fica com a fila geral, não com tudo',
    conversationScope(member('ATENDENTE', [])),
    comFilas([])
)

/**
 * O buraco do colaborar é **por pessoa**, e isso é o que o torna defensável.
 *
 * O recorte carrega o `userId` de quem está perguntando, então a cláusula casa
 * só as conversas em que **aquela** pessoa colabora. Se ela fosse escrita sem
 * o `userId` — `collaborators: { some: {} }` —, qualquer conversa com um
 * colaborador qualquer ficaria visível para o atendente inteiro, e o buraco
 * deixaria de ser de uma conversa para ser de todas as que alguém acompanha.
 */
eq(
    'o recorte do colaborar é de quem pergunta, não de qualquer colaborador',
    conversationScope({ ...member('ATENDENTE', ['comercial']), userId: 'outra-pessoa' }),
    {
        AND: [
            {
                OR: [
                    { integration: { departmentId: { in: ['comercial'] } } },
                    ...filaGeral,
                    { collaborators: { some: { userId: 'outra-pessoa' } } },
                ],
            },
        ],
    }
)

/** Gestão segue sem recorte: ela já vê tudo, e colaborar não acrescenta nada. */
eq('GESTOR não ganha cláusula de colaborar', conversationScope(member('GESTOR', ['comercial'])), {})

console.log('\n— o teto de unidades da conta')

/**
 * A soma que decide se a clínica abre outra unidade, conferida aqui porque
 * três lugares dependem dela: a tela que mostra "1 de 3", a trava dentro da
 * transação que cria, e a recusa de descer de plano. Divergirem é a clínica ver
 * um teto e encontrar outro — ou ganhar uma unidade de graça.
 */
eq('Digital inclui uma unidade', tetoDeUnidades('flow', 0), 1)
eq('Prime inclui uma unidade', tetoDeUnidades('pro', 0), 1)
eq('Multiclínica inclui três', tetoDeUnidades('advanced', 0), 3)

// O adicional vale em qualquer plano — não é privilégio do Multiclínica. É a
// regra do Andre em PRODUCT.md §12, e a soma é o que a implementa.
eq('Digital com dois adicionais cabe três', tetoDeUnidades('flow', 2), 3)
eq('Multiclínica com um adicional cabe quatro', tetoDeUnidades('advanced', 1), 4)

// Plano desconhecido cai no de entrada, como `limitsFor` — e não em zero: a
// conta **tem** uma unidade, é por ela que a pessoa está logada, e um teto zero
// faria a tela anunciar "1 de 0" e a trava recusar o que já existe.
eq('sem plano, o teto é o do plano de entrada', tetoDeUnidades(null, 0), 1)
eq('plano desconhecido não zera o teto', tetoDeUnidades('ouro', 0), 1)

// Adicional negativo não desconta. Não há caminho que o produza hoje — é uma
// contagem de linhas —, e é exatamente por isso que vale travar: o dia em que
// alguém passar um saldo calculado aqui, a trava não vai virar "cabe zero".
eq('adicional negativo não derruba o teto', tetoDeUnidades('pro', -5), 1)

console.log('\n— o que o adicional soma, e o que não soma')

/**
 * Cada unidade adicional traz 1 unidade, 1 agente e 1 número — **e crédito
 * nenhum**, decidido em 2026-10-19: 10.000 avulsos custam R$ 49, então embutir
 * franquia no adicional daria de graça o que já se compra, e abriria uma
 * terceira origem de crédito na tela.
 *
 * Três lugares dependem desta soma — a tela, a aplicação de plano e a renovação
 * mensal —, e errar aqui é cliente pagando por capacidade que o sistema recusa,
 * ou ganhando a que não comprou.
 */
eq('Digital puro', limitesEfetivos('flow', 0), {
    maxWorkspaces: 1, maxAgents: 1, maxWhatsAppNumbers: 1,
    credits: 10_000, maxMessages: 10_000, maxSpokenReplies: 400,
    maxBroadcastRecipientsPerMonth: 1_000, maxEmailsPerMonth: 10_000,
})

eq('Digital + 1 adicional dobra a capacidade, não o consumo', limitesEfetivos('flow', 1), {
    maxWorkspaces: 2, maxAgents: 2, maxWhatsAppNumbers: 2,
    credits: 10_000, maxMessages: 10_000, maxSpokenReplies: 400,
    maxBroadcastRecipientsPerMonth: 1_000, maxEmailsPerMonth: 10_000,
})

// O caso da Venn360 ao descer para o Digital com dois adicionais: 3 agentes, e
// portanto nenhum agente pausado. Era o problema que a mudança veio resolver.
eq('Digital + 2 adicionais', limitesEfetivos('flow', 2), {
    maxWorkspaces: 3, maxAgents: 3, maxWhatsAppNumbers: 3,
    credits: 10_000, maxMessages: 10_000, maxSpokenReplies: 400,
    maxBroadcastRecipientsPerMonth: 1_000, maxEmailsPerMonth: 10_000,
})

eq('Multiclínica + 2 adicionais', limitesEfetivos('advanced', 2), {
    maxWorkspaces: 5, maxAgents: 5, maxWhatsAppNumbers: 8,
    credits: 30_000, maxMessages: 30_000, maxSpokenReplies: 1_500,
    maxBroadcastRecipientsPerMonth: 20_000, maxEmailsPerMonth: 200_000,
})

/**
 * Duas caixas d'água, e só duas: o adicional não toca na franquia.
 *
 * É a asserção que impede o modelo de voltar a crescer sem alguém decidir —
 * mudar `ADICIONAL_INCLUI.credits` para qualquer coisa acima de zero quebra
 * aqui, não em produção.
 */
eq('o adicional não mexe na franquia do plano',
   limitesEfetivos('advanced', 7).credits, limitesEfetivos('advanced', 0).credits)
eq('nem no teto de fala',
   limitesEfetivos('advanced', 7).maxSpokenReplies, limitesEfetivos('advanced', 0).maxSpokenReplies)
/**
 * Nem no teto de e-mail, pela mesma razão: o adicional vende **unidade**, não
 * alcance de campanha. As unidades novas dividem o teto mensal da conta.
 */
eq('nem no teto de e-mail',
   limitesEfetivos('advanced', 7).maxEmailsPerMonth, limitesEfetivos('advanced', 0).maxEmailsPerMonth)

/**
 * A escada de planos, que é o que justifica o preço do adicional. Quem quer 3
 * agentes paga menos no Multiclínica **e** leva o dobro de números e o triplo
 * de crédito.
 */
eq('3 agentes por Digital + 2 adicionais custa mais que o Multiclínica',
   970 > 890, true)
eq('e ainda leva menos números',
   limitesEfetivos('flow', 2).maxWhatsAppNumbers < limitesEfetivos('advanced', 0).maxWhatsAppNumbers,
   true)
eq('e menos crédito',
   limitesEfetivos('flow', 2).credits < limitesEfetivos('advanced', 0).credits, true)

/**
 * Expandir pelo adicional continua mais barato que assinar um Digital novo,
 * **somado** o pacote de crédito que o adicional deixou de embutir. É a conta
 * que sustenta a decisão: R$ 290 + R$ 49 contra R$ 390.
 */
eq('expandir sai mais barato que uma assinatura nova',
   PRECO_ADICIONAL + 49 < PLAN_PRICES.flow, true)

// Teto de unidades continua saindo da mesma conta, agora derivado.
eq('o teto de unidades acompanha', tetoDeUnidades('advanced', 2), 5)

console.log('\n— a carência de quem atrasou')

/**
 * 3 dias no cartão, 2 no Pix, contados do **dia do vencimento** — decisão do
 * Andre. É a conta que decide o dia em que uma clínica para de atender, então
 * ela é conferida aqui e não no olho.
 */
eq('cartão tem 3 dias', carenciaEmDias('CREDIT_CARD'), 3)
eq('Pix tem 2', carenciaEmDias('PIX'), 2)
eq('meio desconhecido cai no mais generoso', carenciaEmDias(null), 3)

/**
 * O vencimento chega do Asaas como data pura ("2026-11-18"), e o espelho o
 * grava ao meio-dia de São Paulo. As linhas antigas o gravaram à meia-noite
 * UTC — que em São Paulo é o dia **anterior**. As duas têm de dar a mesma
 * carência, senão o corte chega um dia antes para quem assinou cedo.
 */
const venceMeiaNoiteUtc = new Date('2026-11-18T00:00:00Z')
const venceMeioDiaSp = new Date('2026-11-18T15:00:00Z')

const diaDoCorte = (d: Date, meio: string) =>
    fimDaCarencia(d, meio).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

eq('cartão: vence 18, corta depois do dia 21', diaDoCorte(venceMeiaNoiteUtc, 'CREDIT_CARD'), '21/11/2026')
eq('Pix: vence 18, corta depois do dia 20', diaDoCorte(venceMeiaNoiteUtc, 'PIX'), '20/11/2026')
eq('e as duas formas de gravar a data concordam',
   fimDaCarencia(venceMeiaNoiteUtc, 'CREDIT_CARD').getTime(),
   fimDaCarencia(venceMeioDiaSp, 'CREDIT_CARD').getTime())

/**
 * A carência vale o **dia inteiro**: quem lê "até dia 21" paga no dia 21 à
 * tarde. Cortar às 9h do dia 21 seria cumprir a letra e quebrar a promessa.
 */
const fimDaCarenciaCartao = fimDaCarencia(venceMeiaNoiteUtc, 'CREDIT_CARD')
eq('ainda dá tempo às 18h do último dia',
   carenciaVencida(fimDaCarenciaCartao, new Date('2026-11-21T21:00:00Z')), false)
eq('e acabou na virada para o dia seguinte',
   carenciaVencida(fimDaCarenciaCartao, new Date('2026-11-22T03:00:01Z')), true)
eq('sem carência gravada, não corta ninguém', carenciaVencida(null, new Date()), false)

console.log('\n— trocar de plano no meio de um ciclo pago')

eq('mensalidade soma os adicionais', mensalidade('flow', 2), 970)
eq('Multiclínica com 2 adicionais', mensalidade('advanced', 2), 1470)

eq('primeira contratação', direcaoDaTroca(null, 'flow'), 'primeira')
eq('subir é upgrade', direcaoDaTroca('flow', 'advanced'), 'upgrade')
eq('descer é downgrade', direcaoDaTroca('advanced', 'flow'), 'downgrade')
eq('mesmo plano não é troca', direcaoDaTroca('pro', 'pro'), 'igual')

// Um ciclo de 30 dias com 15 pela frente: metade da diferença.
const inicio = new Date('2026-10-18T12:00:00-03:00')
const fim = new Date('2026-11-17T12:00:00-03:00')
const meio = new Date('2026-11-02T12:00:00-03:00')

console.log('\n— a unidade adicional contratada no meio do ciclo')

/**
 * A regra da fase 3, decidida com o Andre: a unidade vale a partir do
 * pagamento, e por isso só o pedaço que falta do ciclo é cobrado agora. A
 * renovação cobra o mês inteiro dela **somado ao plano**, numa fatura só.
 *
 * Sem esta conta, as duas saídas são ruins: cobrar R$ 290 cheios no dia 28 é
 * cobrar duas vezes os mesmos dois dias, e esperar a renovação é entregar hoje
 * o que só será pago em trinta dias.
 */
eq('meio ciclo, uma unidade',
   proporcionalDoAdicional({ unidades: 1, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: meio }).valor,
   145)

eq('meio ciclo, duas unidades',
   proporcionalDoAdicional({ unidades: 2, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: meio }).valor,
   290)

// Um dia de R$ 290 são R$ 9,67 — acima do mínimo do gateway, então cobra.
// O ciclo fecha em 17/11, então "um dia restante" é o dia 16.
const umDia = proporcionalDoAdicional({
    unidades: 1,
    inicioDoCiclo: inicio,
    fimDoCiclo: fim,
    agora: new Date('2026-11-16T12:00:00-03:00'),
})
eq('um dia ainda cobra', umDia.valor > 0, true)
eq('e é um trinta avos', umDia.valor, 9.67)

// Na virada não sobra dia nenhum: a renovação já vai cobrar o mês cheio.
eq('na virada não cobra nada',
   proporcionalDoAdicional({ unidades: 1, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: fim }).valor,
   0)

eq('e a tela sabe dizer por quê',
   proporcionalDoAdicional({ unidades: 1, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: fim }).abaixoDoMinimo,
   true)

// Zero unidade é compra só de crédito: não há proporcional nenhum.
eq('sem unidade, sem proporcional',
   proporcionalDoAdicional({ unidades: 0, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: meio }).valor,
   0)

/**
 * E o proporcional nunca passa do valor cheio: contratar no primeiro dia paga
 * o mês, não mais que ele. A trava é `Math.min(diasRestantes, diasDoCiclo)`, e
 * ela existe porque `currentPeriodEnd` pode estar mais longe que um ciclo
 * quando o gateway remarca a data.
 */
eq('o proporcional não passa do mês cheio',
   proporcionalDoAdicional({ unidades: 1, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: inicio }).valor,
   290)

eq(
    'upgrade na metade do ciclo cobra metade da diferença',
    diferencaProporcional({ atual: 'flow', novo: 'advanced', adicionais: 0, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: meio }).valor,
    250
)

// Descer não gera cobrança nem devolução: o cliente usa o que pagou.
eq(
    'downgrade não cobra',
    diferencaProporcional({ atual: 'advanced', novo: 'flow', adicionais: 2, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: meio }).valor,
    0
)

// Adicional não entra na diferença: ele não muda com o plano.
eq(
    'o adicional não muda a diferença do upgrade',
    diferencaProporcional({ atual: 'flow', novo: 'advanced', adicionais: 3, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: meio }).valor,
    250
)

// Um dia restante ainda cobra: 300 de diferença em 30 dias dá R$ 10, acima do
// mínimo do Asaas. Com os preços de hoje, o piso só é alcançado no fim exato.
eq(
    'um dia restante cobra um trinta avos',
    diferencaProporcional({ atual: 'pro', novo: 'advanced', adicionais: 0, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: new Date('2026-11-16T12:00:00-03:00') }).valor,
    10
)

/**
 * Trocar no instante da virada: não há dias a proporcionalizar, então não se
 * cobra nada e o preço novo entra com o ciclo seguinte. É o caso que a trava do
 * mínimo existe para atender.
 */
const naVirada = diferencaProporcional({ atual: 'flow', novo: 'pro', adicionais: 0, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: fim })
eq('upgrade no instante da virada não cobra', naVirada.valor, 0)
eq('e diz que foi o mínimo', naVirada.abaixoDoMinimo, true)
eq('com zero dias restantes', naVirada.diasRestantes, 0)

// Sem período gravado — assinatura antiga — assume ciclo cheio.
eq(
    'sem período, cobra a diferença integral',
    diferencaProporcional({ atual: 'flow', novo: 'pro', adicionais: 0, inicioDoCiclo: null, fimDoCiclo: null, agora: meio }).valor,
    200
)


console.log('\n— o ciclo anual: 10% em todos os planos')
eq('Digital anual', valorDaFatura('flow', 0, 'annual'), 4212)
eq('Prime anual', valorDaFatura('pro', 0, 'annual'), 6372)
eq('Multiclínica anual', valorDaFatura('advanced', 0, 'annual'), 9612)
eq('mensal não desconta', valorDaFatura('pro', 0, 'monthly'), 590)
// A unidade adicional entra no desconto: ela é parte da mensalidade, e cobrar
// 10% menos no plano e cheio no adicional faria duas regras na mesma fatura.
eq('com adicional, desconta os dois', valorDaFatura('pro', 1, 'annual'), (590 + 290) * 12 * 0.9)
eq('o mensal equivalente é o que o cartão compara', mensalEquivalente('advanced', 0, 'annual'), 801)
eq('e a economia é de um mês e um pouco', economiaDoAnual('advanced', 0), 1068)

console.log('\n— a direção, agora que o ciclo também muda')
eq('mensal para anual é ciclo novo', direcaoDoContrato({ plan: 'pro', ciclo: 'monthly' }, { plan: 'pro', ciclo: 'annual' }), 'novo-ciclo')
eq('anual para mensal é descer', direcaoDoContrato({ plan: 'pro', ciclo: 'annual' }, { plan: 'pro', ciclo: 'monthly' }), 'downgrade')
eq('subir de plano no mesmo ciclo', direcaoDoContrato({ plan: 'flow', ciclo: 'annual' }, { plan: 'pro', ciclo: 'annual' }), 'upgrade')
eq('igual é igual nos dois eixos', direcaoDoContrato({ plan: 'pro', ciclo: 'annual' }, { plan: 'pro', ciclo: 'annual' }), 'igual')
eq('sem contrato é a primeira', direcaoDoContrato(null, { plan: 'pro', ciclo: 'monthly' }), 'primeira')
// Subir de plano E de ciclo ao mesmo tempo é ciclo novo: quem manda é o ciclo,
// porque é ele que reinicia a cobrança. O plano entra no valor.
eq('subir os dois é ciclo novo', direcaoDoContrato({ plan: 'flow', ciclo: 'monthly' }, { plan: 'advanced', ciclo: 'annual' }), 'novo-ciclo')

console.log('\n— quanto se cobra na troca de contrato')
const cicloMensal = { inicioDoCiclo: inicio, fimDoCiclo: fim, agora: meio }

// Upgrade dentro do mensal: a conta de sempre, intacta.
eq(
    'upgrade mensal continua sendo a diferença proporcional',
    diferencaDeContrato({ atual: { plan: 'flow', ciclo: 'monthly' }, novo: { plan: 'pro', ciclo: 'monthly' }, adicionais: 0, ...cicloMensal }).cobranca.valor,
    100
)

/**
 * Mensal para anual no meio do mês pago: cobra o ano menos o saldo.
 *
 * 15 dos 30 dias de um Prime de R$ 590 valem R$ 295, e o ano custa R$ 6.372.
 * Sem o abatimento, trocar de ciclo no dia 15 cobraria duas vezes a mesma
 * quinzena.
 */
eq(
    'trocar para anual desconta o saldo do mês',
    diferencaDeContrato({ atual: { plan: 'pro', ciclo: 'monthly' }, novo: { plan: 'pro', ciclo: 'annual' }, adicionais: 0, ...cicloMensal }).cobranca.valor,
    6372 - 295
)

// Na virada exata não há saldo: o ano inteiro é cobrado.
eq(
    'na virada, o anual é cheio',
    diferencaDeContrato({ atual: { plan: 'pro', ciclo: 'monthly' }, novo: { plan: 'pro', ciclo: 'annual' }, adicionais: 0, inicioDoCiclo: inicio, fimDoCiclo: fim, agora: fim }).cobranca.valor,
    6372
)

// Descer — plano menor ou volta ao mensal — não cobra nada hoje.
eq(
    'voltar ao mensal não cobra',
    diferencaDeContrato({ atual: { plan: 'pro', ciclo: 'annual' }, novo: { plan: 'pro', ciclo: 'monthly' }, adicionais: 0, ...cicloMensal }).cobranca.valor,
    0
)

/**
 * Upgrade **dentro** do anual: a diferença das duas faturas anuais,
 * proporcional aos dias que faltam do ano.
 *
 * É o caso que o `valorMensal` antigo errava por doze: 6.372 → 9.612 são
 * R$ 3.240 por ano; faltando meio ano, cobra-se a metade.
 */
const anoInicio = new Date('2026-01-01T12:00:00-03:00')
const anoFim = new Date(anoInicio.getTime() + 365 * 86_400_000)
const meioDoAno = new Date(anoInicio.getTime() + 182 * 86_400_000)
eq(
    'upgrade no anual é proporcional ao ano',
    diferencaDeContrato({ atual: { plan: 'pro', ciclo: 'annual' }, novo: { plan: 'advanced', ciclo: 'annual' }, adicionais: 0, inicioDoCiclo: anoInicio, fimDoCiclo: anoFim, agora: meioDoAno }).cobranca.valor,
    Math.round(((9612 - 6372) * 183) / 365 * 100) / 100
)

// A primeira contratação cobra a fatura cheia do ciclo escolhido.
eq(
    'primeira contratação anual cobra o ano',
    diferencaDeContrato({ atual: null, novo: { plan: 'advanced', ciclo: 'annual' }, adicionais: 0, inicioDoCiclo: null, fimDoCiclo: null, agora: meio }).cobranca.valor,
    9612
)

console.log('\n— as duas datas: franquia e cobrança')
eq('o mensal cobra em 30 dias', proximaCobranca('monthly', inicio).toISOString(), new Date(inicio.getTime() + 30 * 86_400_000).toISOString())
eq('o anual, em 365', proximaCobranca('annual', inicio).toISOString(), new Date(inicio.getTime() + 365 * 86_400_000).toISOString())
// O começo do ciclo de cobrança é deduzido do fim, sem coluna: é exato porque
// `renewsAt` só se move em passos de um ciclo.
eq('o início sai do fim', inicioDaCobranca('annual', anoFim)?.toISOString(), anoInicio.toISOString())
eq('sem fim, não há início', inicioDaCobranca('monthly', null), null)

console.log('\n— o treinamento de agente')
// A promoção vale até o último dia de novembro de 2026, e a conta é no
// calendário de São Paulo: às 22h do dia 30 em SP já é dia 1º em UTC, e o Worker
// roda em UTC.
eq('na promoção, R$ 2.400', precoDoTreinamento(new Date('2026-11-07T12:00:00-03:00')).valor, 2400)
eq('no último dia ainda vale', precoDoTreinamento(new Date('2026-11-30T22:00:00-03:00')).valor, 2400)
eq('no dia seguinte, tabela cheia', precoDoTreinamento(new Date('2026-12-01T09:00:00-03:00')).valor, 3400)
eq('e a tela sabe que acabou', precoDoTreinamento(new Date('2026-12-01T09:00:00-03:00')).promocional, false)
// 23h de 30/11 em São Paulo é 1º/12 em UTC: sem o fuso, a promoção terminaria
// uma hora antes para quem está no Brasil.
eq('a virada é a de São Paulo', precoDoTreinamento(new Date('2026-12-01T01:00:00Z')).promocional, true)

console.log('\n— quem ganha o treinamento')
eq('Multiclínica anual inclui 1', treinamentoIncluido('advanced', 'annual'), 1)
eq('Multiclínica mensal, nenhum', treinamentoIncluido('advanced', 'monthly'), 0)
eq('Prime anual, nenhum', treinamentoIncluido('pro', 'annual'), 0)
eq('Digital anual, nenhum', treinamentoIncluido('flow', 'annual'), 0)

console.log('\n— os dados de cobrança, antes de abrir o pagamento')
const completo = {
    cpfCnpj: '12345678901',
    postalCode: '30110000',
    address: 'Av. Afonso Pena',
    addressNumber: '1000',
    province: 'Centro',
    city: 'Belo Horizonte',
    state: 'MG',
    billingPhone: '31999999999',
}
eq('completo passa', conferirCobranca(completo).completo, true)
eq('e devolve os oito campos', Object.keys(cobrancaCompleta(completo) ?? {}).length, 8)
// O complemento não entra: nem o Asaas o exige, nem metade dos endereços o tem.
eq('sem complemento continua completo', conferirCobranca({ ...completo, complement: null }).completo, true)
eq('faltando o número, não está completo', conferirCobranca({ ...completo, addressNumber: '' }).completo, false)
eq('mas ainda dá para cobrar com documento', conferirCobranca({ ...completo, addressNumber: '' }).podeCobrar, true)
eq('sem documento não dá', conferirCobranca({ ...completo, cpfCnpj: null }).podeCobrar, false)
eq('espaço em branco não preenche campo', conferirCobranca({ ...completo, city: '   ' }).faltando, ['city'])
eq('a frase lista o que falta', listarFaltantes(['postalCode', 'addressNumber', 'billingPhone']), 'CEP, número e telefone')
eq('e com um só, sem vírgula', listarFaltantes(['cpfCnpj']), 'CPF ou CNPJ')
eq('nada faltando, frase vazia', listarFaltantes([]), '')
eq('incompleto não vira pagador', cobrancaCompleta({ ...completo, state: '' }), null)

console.log(fails === 0 ? '\nTodos passaram.' : `\n${fails} falharam.`)
process.exit(fails === 0 ? 0 : 1)
