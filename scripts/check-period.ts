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
import { periodRange, matchPreset, resolvePeriodParams, isoDay } from '@/lib/period'
import { resolveOwnerScope, canSeeEveryone, conversationScope, type WorkspaceRole } from '@/lib/auth/workspace'
import { limitesEfetivos, tetoDeUnidades, PRECO_ADICIONAL, PLAN_PRICES } from '@/lib/plan-limits'
import { carenciaEmDias, fimDaCarencia, carenciaVencida } from '@/lib/billing/inadimplencia'
import {
    diferencaProporcional,
    direcaoDaTroca,
    mensalidade,
    proporcionalDoAdicional,
} from '@/lib/billing/troca-de-plano'

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
const comFilas = (ids: string[]) => ({
    AND: [{ OR: [{ integration: { departmentId: { in: ids } } }, ...filaGeral] }],
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
    maxBroadcastRecipientsPerMonth: 1_000,
})

eq('Digital + 1 adicional dobra a capacidade, não o consumo', limitesEfetivos('flow', 1), {
    maxWorkspaces: 2, maxAgents: 2, maxWhatsAppNumbers: 2,
    credits: 10_000, maxMessages: 10_000, maxSpokenReplies: 400,
    maxBroadcastRecipientsPerMonth: 1_000,
})

// O caso da Venn360 ao descer para o Digital com dois adicionais: 3 agentes, e
// portanto nenhum agente pausado. Era o problema que a mudança veio resolver.
eq('Digital + 2 adicionais', limitesEfetivos('flow', 2), {
    maxWorkspaces: 3, maxAgents: 3, maxWhatsAppNumbers: 3,
    credits: 10_000, maxMessages: 10_000, maxSpokenReplies: 400,
    maxBroadcastRecipientsPerMonth: 1_000,
})

eq('Multiclínica + 2 adicionais', limitesEfetivos('advanced', 2), {
    maxWorkspaces: 5, maxAgents: 5, maxWhatsAppNumbers: 8,
    credits: 30_000, maxMessages: 30_000, maxSpokenReplies: 1_500,
    maxBroadcastRecipientsPerMonth: 20_000,
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

console.log(fails === 0 ? '\nTodos passaram.' : `\n${fails} falharam.`)
process.exit(fails === 0 ? 0 : 1)
