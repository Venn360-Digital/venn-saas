import {
    CREDIT_PACKS,
    planList,
    TRIAL,
    TREINAMENTO_DE_AGENTE,
    UNIDADE_ADICIONAL,
    creditPackFor,
    formatPrice,
    planFor,
} from '@venn/core/lib/plans'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { canBuyAddons, getBillingState, spokenRepliesLeft } from '@venn/core/lib/billing'
import {
    CICLOS,
    TREINAMENTO,
    cicloDe,
    isBillingCycle,
    isPlanId,
    limitesEfetivos,
    precoDoTreinamento,
    tetoDeUnidades,
    treinamentoIncluido,
    valorDaFatura,
} from '@venn/core/lib/plan-limits'
import { criarCheckoutDePlano, criarCheckoutDeAdicionais } from '@venn/core/lib/asaas/checkout'
import { cobrarNoCartaoSalvo } from '@venn/core/lib/asaas/cobranca-no-cartao'
import { regimeDaConta } from '@venn/core/lib/asaas/cobranca'
import { aplicarAdicionais } from '@venn/core/lib/billing/aplicar-adicionais'
import { AsaasError, asaas } from '@venn/core/lib/asaas/client'
import { aplicarPlano } from '@venn/core/lib/billing/aplicar-plano'
import {
    descreverAssinatura,
    recriarAssinatura,
    sincronizarValorDaAssinatura,
    trocarCicloNoGateway,
} from '@venn/core/lib/asaas/vincular'
import {
    MINIMO_DO_ASAAS,
    diferencaDeContrato,
    inicioDaCobranca,
    proporcionalDoAdicional,
    proximaCobranca,
} from '@venn/core/lib/billing/troca-de-plano'
import { cobrancaCompleta, conferirCobranca, listarFaltantes } from '@venn/core/lib/billing/dados-de-cobranca'

/**
 * O endereço desta aplicação, para o Asaas devolver o pagador.
 *
 * Do cabeçalho da requisição e não de `NEXT_PUBLIC_APP_URL`: a variável é
 * assada no build, e um deploy com ela errada mandaria o cliente de volta para
 * o domínio anterior depois de pagar. O host que atendeu a chamada é o host em
 * que a pessoa está.
 */
function baseDaAplicacao(request: NextRequest): string {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    return host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_APP_URL ?? '')
}
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { contaDoMaster, accountIdOf, adicionaisCobraveis, adicionaisVivos, assinaturaDaUnidade, daContaDaUnidade, unidadesDaConta } from '@venn/core/lib/account'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'


/**
 * The plans as JSON. The shared definition carries Lucide components for the
 * channel row, which cannot be serialised, so the client imports those directly
 * and only the data travels.
 */
/*
 * Função memoizada, e não constante: `planList()` lê a marca pelo vocabulário
 * das descrições, e `BRAND()` é fail-fast. Uma constante aqui é avaliada quando
 * a Cloudflare VALIDA o script — sem requisição e sem marca registrada — e a
 * publicação reprova com `MarcaNaoRegistradaError`. O `check:marca-tardia`
 * pegou isto no instante em que o vocabulário entrou em `lib/plans.ts`.
 */
function montarPlanosJson() {
    return Object.fromEntries(
    planList().map((p) => [
        p.id,
        {
            name: p.name,
            icon: p.icon,
            iconDark: p.iconDark,
            description: p.description,
            price: p.price,
            badge: p.badge ?? null,
            features: p.features,
            /**
             * O preço nos dois ciclos, pronto.
             *
             * A tela poderia calcular — as funções são puras e ela as importa
             * para outras coisas —, mas quem decide preço é o servidor. Mandar o
             * número feito é o que garante que o cartão e a fatura concordem no
             * dia em que o desconto do anual mudar.
             */
            precos: {
                monthly: {
                    fatura: valorDaFatura(p.id, 0, 'monthly'),
                    mensal: valorDaFatura(p.id, 0, 'monthly'),
                },
                annual: {
                    fatura: valorDaFatura(p.id, 0, 'annual'),
                    mensal: valorDaFatura(p.id, 0, 'annual') / 12,
                },
            },
            /** Quantos treinamentos este plano inclui, por ciclo. */
            treinamentoIncluido: {
                monthly: treinamentoIncluido(p.id, 'monthly'),
                annual: treinamentoIncluido(p.id, 'annual'),
            },
            ...p.limits,
        },
    ])
)
}

let planosJsonCache: ReturnType<typeof montarPlanosJson> | null = null
function planosJson() {
    if (planosJsonCache === null) planosJsonCache = montarPlanosJson()
    return planosJsonCache
}

/**
 * O catálogo do treinamento, como a tela o recebe.
 *
 * Função e não constante porque o preço depende do **dia**: a promoção termina,
 * e um valor congelado na carga do módulo seguiria em promoção até o próximo
 * deploy. O Worker vive por horas.
 */
function treinamentoParaATela() {
    const preco = precoDoTreinamento()

    return {
        name: TREINAMENTO_DE_AGENTE.name,
        pitch: TREINAMENTO_DE_AGENTE.pitch,
        rodape: TREINAMENTO_DE_AGENTE.rodape,
        maximoPorCompra: TREINAMENTO.maximoPorCompra,
        ...preco,
    }
}

/**
 * O estado dos dados de cobrança — e por que ele vem nesta rota.
 *
 * A guia de plano precisa saber, **antes** do clique, se o checkout vai poder
 * ser aberto: é isso que permite abrir o formulário ali mesmo em vez de mandar
 * a pessoa para outra guia e esperar que ela volte (a queixa do Andre em
 * 2026-11-07). Pedir isso a `/api/account` seria uma segunda chamada para
 * desenhar a primeira tela.
 *
 * **Os valores só vão para quem pode gravá-los.** Endereço e documento de
 * cobrança são da conta, e `contaDoMaster` é a camada que o projeto já usa para
 * eles — o mesmo portão dos cartões salvos, logo acima. Para quem não é o
 * responsável, vai só a contagem do que falta: a tela precisa dela para explicar
 * por que o botão de contratar leva a uma recusa, sem mostrar dado de cobrança a
 * quem não cuida da fatura.
 */
async function cobrancaDaConta(accountId: string | null, souMaster: boolean) {
    if (!accountId) return null

    const conta = await prisma.account.findUnique({
        where: { id: accountId },
        select: {
            cpfCnpj: true,
            postalCode: true,
            address: true,
            addressNumber: true,
            complement: true,
            province: true,
            city: true,
            state: true,
            billingPhone: true,
        },
    })

    if (!conta) return null

    const estado = conferirCobranca(conta)

    return {
        ...estado,
        souMaster,
        /** Para o formulário nascer preenchido com o que já existe. */
        dados: souMaster ? conta : null,
    }
}

// GET /api/account/subscription - Get subscription details
export async function GET() {
    try {
        const workspaceUser = await currentMembership()
        const workspace = workspaceUser
            ? await prisma.workspace.findUnique({
                where: { id: workspaceUser.workspaceId },
                select: { name: true },
            })
            : null

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const subscription = await prisma.subscription.findFirst({
            where: assinaturaDaUnidade(workspaceUser.workspaceId),
        })

        const accountId = await accountIdOf(workspaceUser.workspaceId)
        const unidades = accountId
            ? await unidadesDaConta(accountId)
            : { used: 0, max: 0, remaining: 0, doPlano: 0, adicionais: 0 }

        /**
         * O crédito como a sidebar o vê: franquia **mais** lotes avulsos.
         *
         * Esta rota devolvia só `credits`/`creditsUsed` da assinatura — a
         * franquia do plano —, e o medidor da guia desenhava aquilo. Quem
         * comprasse 10.000 avulsos via a sidebar somar e o medidor continuar em
         * "33 de 20.000": duas fontes para a mesma pergunta, duas respostas, e a
         * menor delas na tela onde a compra acabou de acontecer.
         *
         * `getBillingState` é a fonte única dessa conta, e agora as duas telas
         * leem dela.
         */
        const estado = await getBillingState(workspaceUser.workspaceId)

        if (!subscription) {
            // No subscription row means onboarding predates the step that
            // creates one. Say so rather than reporting a plan the workspace was
            // never actually put on.
            return NextResponse.json({
                plan: null,
                planName: null,
                workspaceName: workspace?.name ?? null,
                status: 'none',
                maxAgents: 0,
                maxMessages: 0,
                maxWhatsAppNumbers: 0,
                credits: 0,
                creditsUsed: 0,
                maxSpokenReplies: 0,
                spokenRepliesUsed: 0,
                paymentMethod: null,
                trialEndsAt: null,
                plans: planosJson(),
                trial: TRIAL,
                creditPacks: CREDIT_PACKS,
                treinamento: treinamentoParaATela(),
                treinamentos: [],
                billingCycle: 'monthly',
                renewsAt: null,
                canceledAt: null,
                cobranca: await cobrancaDaConta(
                    accountId,
                    accountId
                        ? (await contaDoMaster(workspaceUser.workspaceId, workspaceUser.userId)).ok
                        : false
                ),
                creditos: estado.credits,
                // A mesma forma do caso com assinatura: uma resposta que às
                // vezes traz o campo e às vezes não obriga a tela a adivinhar.
                unidades,
            })
        }

        const planConfig = planFor(subscription.plan)

        return NextResponse.json({
            plan: subscription.plan,
            planName: planConfig.name,
            workspaceName: workspace?.name ?? null,
            maxWhatsAppNumbers: subscription.maxWhatsAppNumbers,
            trial: TRIAL,
            status: subscription.status,
            maxAgents: subscription.maxAgents,
            maxMessages: subscription.maxMessages,
            credits: subscription.credits,
            creditsUsed: subscription.creditsUsed,
            maxSpokenReplies: subscription.maxSpokenReplies,
            // Medido em `usage_logs`, não contado numa coluna: é a mesma fonte
            // que o teto usa no worker, então a tela e a decisão não divergem.
            spokenRepliesUsed:
                subscription.maxSpokenReplies -
                (await spokenRepliesLeft(workspaceUser.workspaceId)),
            paymentMethod: subscription.paymentMethod,
            /**
             * Os cartões que já pagaram algo desta conta.
             *
             * A tela precisa deles para **trocar** o cartão da assinatura sem
             * pedir o número: a troca no Asaas aceita um token já conhecido, e
             * o token nasce de um pagamento na página deles.
             */
            /**
             * `asaasToken` **só para quem administra**.
             *
             * O token é credencial reutilizável — o comentário acima diz para
             * que serve: trocar o cartão da assinatura sem pedir o número. E a
             * rota inteira estava atrás de `currentMembership()` sem recorte de
             * papel, então um ATENDENTE o lia.
             *
             * **E o portão é `contaDoMaster`, não o papel na unidade.** A
             * hierarquia é CONTA → WORKSPACE: `PaymentCard` pende de
             * `accountId`, e uma conta pode ter várias unidades. Conferir
             * `role` daria o token da conta ao ADMIN de **qualquer** unidade
             * dela — incluindo a franquia pequena cujo responsável não é o de
             * quem paga. O projeto já decidiu essa camada: criar unidade,
             * renomear, trocar CNPJ e mover agente passam por `contaDoMaster`
             * (`lib/account.ts:202`). Pagar é no mínimo tão da conta quanto
             * renomear.
             *
             * Por que não 403 na rota toda: o resto da resposta (plano, fim da
             * avaliação, créditos) alimenta o aviso de avaliação que o
             * atendente **vê**. Fechar o campo mantém a tela e tira a
             * credencial; fechar a rota tiraria as duas coisas.
             *
             * **Mudança de comportamento, de propósito:** ADMIN que não é o
             * responsável pela conta deixa de ver os cartões salvos. Era isso
             * ou deixar credencial de pagamento atravessando a fronteira da
             * conta.
             */
            cartoes:
                accountId && (await contaDoMaster(workspaceUser.workspaceId, workspaceUser.userId)).ok
                    ? await prisma.paymentCard.findMany({
                          where: { accountId },
                          orderBy: { lastSeenAt: 'desc' },
                          select: { id: true, asaasToken: true, brand: true, last4: true, isDefault: true },
                      })
                    : [],
            trialEndsAt: subscription.trialEndsAt,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            /**
             * Mensal ou anual, e quando a **cobrança** se repete.
             *
             * `renewsAt` responde "quando vou pagar de novo" e
             * `currentPeriodEnd`, "quando o crédito renova". Elas coincidem no
             * mensal e se afastam no anual; mandar as duas é o que permite a tela
             * dizer cada coisa no seu lugar em vez de chamar as duas de
             * "renovação". A queda para trás (`?? currentPeriodEnd`) atende a
             * assinatura criada antes da coluna existir.
             */
            billingCycle: subscription.billingCycle,
            renewsAt: subscription.renewsAt ?? subscription.currentPeriodEnd,
            /** Quando o cancelamento foi pedido — a faixa da tela nasce disto. */
            canceledAt: subscription.canceledAt,
            /**
             * Até quando a clínica tem para regularizar, quando há atraso.
             *
             * Vai para a tela porque a carência só protege quem sabe dela: um
             * aviso que diz "em atraso" sem dizer até quando é susto sem
             * instrução.
             */
            graceEndsAt: subscription.graceEndsAt,
            /**
             * Se esta conta é cobrada — a tela precisa dizer isso **antes** do
             * clique. Conta vitalícia recebe adicional sem cobrança, e anunciar
             * isso só na mensagem de sucesso faz quem testa concluir que o
             * gateway falhou.
             */
            /**
             * Os adicionais **um a um**, para a faixa poder enfileirá-los.
             *
             * Antes iam só as contagens, e a tela escrevia uma frase por grupo
             * — "3 contratações de unidade", "10.000 créditos avulsos". Com
             * duas compras de crédito em datas diferentes, a frase precisava
             * escolher uma validade e escondia a outra. Cada contrato é uma
             * linha porque cada contrato tem a sua data.
             */
            contratosDeUnidade: accountId
                ? await prisma.unitAddon.findMany({
                      where: { accountId, ...adicionaisVivos() },
                      orderBy: { createdAt: 'asc' },
                      select: {
                          id: true,
                          createdAt: true,
                          canceledAt: true,
                          endsAt: true,
                          priceCents: true,
                      },
                  })
                : [],
            lotesDeCredito: await prisma.creditPurchase.findMany({
                where: {
                    ...daContaDaUnidade(workspaceUser.workspaceId),
                    expiresAt: { gt: new Date() },
                },
                orderBy: { expiresAt: 'asc' },
                select: { id: true, amount: true, used: true, expiresAt: true },
            }),
            regime: accountId
                ? await regimeDaConta(accountId)
                : { precisaPagar: true, motivo: null, a_partir_de: null },
            pastDueSince: subscription.pastDueSince,
            plans: planosJson(),
            creditPacks: CREDIT_PACKS,
            treinamento: treinamentoParaATela(),
            /**
             * Os treinamentos contratados, um a um.
             *
             * Como os contratos de unidade e os lotes de crédito: cada um tem a
             * sua data e o seu andamento, e uma frase só ("2 treinamentos")
             * esconderia que um foi entregue e o outro não.
             */
            treinamentos: accountId
                ? await prisma.trainingAddon.findMany({
                      where: { accountId },
                      orderBy: { createdAt: 'asc' },
                      select: {
                          id: true,
                          createdAt: true,
                          priceCents: true,
                          origin: true,
                          status: true,
                          doneAt: true,
                      },
                  })
                : [],
            cobranca: await cobrancaDaConta(
                accountId,
                accountId
                    ? (await contaDoMaster(workspaceUser.workspaceId, workspaceUser.userId)).ok
                    : false
            ),
            /** Franquia e avulso somados, para o medidor não contradizer a sidebar. */
            creditos: estado.credits,
            /**
             * O que o plano vigente **daria**, com os adicionais somados.
             *
             * A tela compara com o que está guardado na assinatura para
             * descobrir, sem coluna nenhuma, que há um downgrade esperando a
             * renovação: teto guardado maior que o do plano vigente só acontece
             * nesse caso. É o que permite a tela dizer "você está no Digital,
             * com os recursos do plano anterior até 18/11" em vez de mostrar
             * Digital e números de Multiclínica sem explicar.
             */
            efetivos: limitesEfetivos(subscription.plan, unidades.adicionais),
            /**
             * As unidades da conta, junto do resto da franquia.
             *
             * Aqui e não numa chamada própria porque a guia de plano já pergunta
             * "o que eu tenho direito" — e unidade é uma das quatro respostas,
             * ao lado de agentes, números e crédito.
             */
            unidades,
        })
    } catch (error) {
        console.error('[API] Error fetching subscription:', error)
        return NextResponse.json({ error: 'Erro ao buscar assinatura' }, { status: 500 })
    }
}

// POST /api/account/subscription - Update subscription (change-plan, buy-credits, cancel)
/**
 * A cesta em palavras, para a mensagem de volta.
 *
 * Uma função porque dois caminhos a escrevem — a conta isenta, que recebe na
 * hora, e a confirmação do pagamento — e duas cópias divergiriam na primeira
 * correção de plural.
 */
function resumoDaCesta(
    pack: { credits: number; price: number } | null,
    unidades: number,
    tetoDeUnidades: number,
    treinamentos = 0
): string {
    const partes: string[] = []

    if (pack) {
        partes.push(`${pack.credits.toLocaleString('pt-BR')} créditos avulsos`)
    }

    if (treinamentos > 0) {
        partes.push(
            `${treinamentos} treinamento${treinamentos === 1 ? '' : 's'} de agente` +
                ' — nossa equipe entra em contato para agendar'
        )
    }

    if (unidades > 0) {
        partes.push(
            `${unidades} unidade${unidades === 1 ? '' : 's'} adicional${unidades === 1 ? '' : 'is'}` +
                ` — você pode ter ${tetoDeUnidades} no total`
        )
    }

    return partes.length ? `Contratado: ${partes.join('; ')}.` : 'Nada a contratar.'
}

export async function POST(request: NextRequest) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await currentMembership()

        if (!workspaceUser || !['OWNER', 'ADMIN'].includes(workspaceUser.role)) {
            return NextResponse.json({ error: 'Permissão negada' }, { status: 403 })
        }

        const body = await request.json()
        const { action, ...data } = body

        switch (action) {
            /**
             * Contratar ou trocar de plano. Desde a fase 2, isto pode cobrar.
             *
             * Três desfechos, e a tela precisa saber qual foi:
             *
             * - **conta que paga** → devolve `link` do checkout do Asaas, e o
             *   plano **não** muda aqui. Quem ativa é o webhook, quando o
             *   dinheiro entra. Ativar na volta do pagador seria dar plano a
             *   quem clicou em "voltar".
             * - **conta vitalícia** (Venn360) → ativa direto, sem cobrar.
             * - **antes da data de início** (Implante Ja até 27/10) → idem.
             *
             * O que **não** muda com a cobrança: a recusa de descer de plano
             * para um que não cabe as unidades existentes. Essa é conferida
             * antes de qualquer checkout, porque criar cobrança para uma troca
             * que vai ser recusada é cobrar por nada.
             */
            case 'change-plan': {
                const { plan, cycle } = data
                if (!isPlanId(plan)) {
                    return NextResponse.json({ error: 'Plano inválido' }, { status: 400 })
                }
                /**
                 * Ciclo ausente conserva o que a conta já tem.
                 *
                 * Um padrão `'monthly'` aqui rebaixaria, calado, o cliente anual
                 * que apenas troca de plano — e o rebaixamento apareceria como
                 * uma fatura de um mês onde havia uma de doze.
                 */
                if (cycle !== undefined && !isBillingCycle(cycle)) {
                    return NextResponse.json(
                        { error: 'Ciclo inválido: use mensal ou anual.' },
                        { status: 400 }
                    )
                }

                const planConfig = planosJson()[plan]

                const accountId = await accountIdOf(workspaceUser.workspaceId)
                if (!accountId) {
                    return NextResponse.json(
                        { error: 'Conta não encontrada para este workspace' },
                        { status: 404 }
                    )
                }

                /**
                 * Descer de plano não pode deixar a conta com mais unidades do
                 * que o plano novo cabe. A saída não é apagar unidade — unidade
                 * tem pacientes, agenda e conversas.
                 */
                const unidades = await unidadesDaConta(accountId)
                /**
                 * O teto que importa aqui é o **de depois da renovação**, e por
                 * isso conta só o que não foi cancelado: descer de plano com um
                 * adicional cancelado de pé passaria na conferência de hoje e
                 * deixaria uma clínica sem vaga na virada — quando o plano
                 * menor e o fim do adicional chegam juntos.
                 */
                const cabe = tetoDeUnidades(plan, unidades.cobraveis)
                if (unidades.used > cabe) {
                    return NextResponse.json(
                        {
                            error:
                                `Você tem ${unidades.used} unidades e o ${planConfig.name} cabe ${cabe}. ` +
                                `Compre ${unidades.used - cabe} unidade${unidades.used - cabe === 1 ? '' : 's'} adicional${unidades.used - cabe === 1 ? '' : 'is'} ` +
                                `ou escolha um plano com mais unidades.`,
                        },
                        { status: 409 }
                    )
                }

                const regime = await regimeDaConta(accountId)

                /**
                 * Três situações, e só uma delas cobra um mês cheio.
                 *
                 * Antes **toda** troca criava um checkout novo com vencimento
                 * hoje, e o Asaas cobrava ao concluir: trocar três vezes num dia
                 * cobrava três meses. O período já pago simplesmente não era
                 * considerado.
                 *
                 * - **primeira contratação** → checkout recorrente, cobra o mês;
                 * - **upgrade** → cobra só a diferença dos dias que faltam, e
                 *   entrega na hora;
                 * - **downgrade** → não cobra nada; o plano muda no registro, o
                 *   preço muda na renovação, e os recursos pagos valem até lá.
                 */
                const assinatura = await prisma.subscription.findUnique({
                    where: { accountId },
                    select: {
                        plan: true,
                        status: true,
                        asaasSubscriptionId: true,
                        currentPeriodStart: true,
                        currentPeriodEnd: true,
                        billingCycle: true,
                        renewsAt: true,
                    },
                })

                const temAssinaturaViva = Boolean(
                    assinatura?.asaasSubscriptionId && assinatura.status === 'active'
                )

                const cicloAtual = cicloDe(assinatura?.billingCycle)
                const ciclo = isBillingCycle(cycle) ? cycle : cicloAtual

                /**
                 * O período que importa aqui é o de **cobrança**.
                 *
                 * `renewsAt` com queda para trás no fim da franquia, e o começo
                 * deduzido dela: num ciclo anual, usar o `currentPeriodStart` da
                 * franquia diria "ciclo de 30 dias" e cobraria doze vezes a
                 * diferença certa num upgrade.
                 */
                const fimDaCobranca = assinatura?.renewsAt ?? assinatura?.currentPeriodEnd ?? null
                const { direcao, cobranca: aCobrar } = diferencaDeContrato({
                    atual:
                        temAssinaturaViva && isPlanId(assinatura?.plan)
                            ? { plan: assinatura.plan, ciclo: cicloAtual }
                            : null,
                    novo: { plan, ciclo },
                    adicionais: unidades.cobraveis,
                    inicioDoCiclo: inicioDaCobranca(cicloAtual, fimDaCobranca),
                    fimDoCiclo: fimDaCobranca,
                    agora: new Date(),
                })

                if (!regime.precisaPagar) {
                    const { notas } = await aplicarPlano({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        plan,
                        ciclo,
                    })

                    const porque =
                        regime.motivo === 'vitalicia'
                            ? 'Conta vitalícia: nada foi cobrado.'
                            : `A cobrança desta conta começa em ${regime.a_partir_de?.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`

                    return NextResponse.json({
                        success: true,
                        pago: false,
                        message:
                            `Plano alterado para ${planConfig.name}. ${porque}` +
                            (notas.length ? ` ${notas.join('; ')}.` : ''),
                    })
                }

                /**
                 * Descer de plano: nada é cobrado, nada é desligado hoje.
                 *
                 * O valor novo vai para a assinatura do Asaas **sem**
                 * `updatePendingPayments` — a cobrança deste mês já foi paga, e
                 * reescrevê-la seria mexer no que o cliente pagou. Ele passa a
                 * valer na próxima.
                 */
                if (direcao === 'downgrade' && assinatura?.asaasSubscriptionId) {
                    const valorNovo = valorDaFatura(plan, unidades.cobraveis, ciclo)
                    const mudaDeCiclo = ciclo !== cicloAtual

                    /**
                     * Mudar o ciclo no gateway vem **antes** de gravar — e,
                     * falhando, nada muda aqui.
                     *
                     * É a ordem do cancelamento, pela mesma razão: o estado que
                     * não pode existir é "mensal aqui, anual lá". Ele cobraria
                     * doze meses onde o cliente espera um, e ele só descobriria
                     * pela fatura. Já a descrição e o valor, logo abaixo, podem
                     * falhar sem desfazer nada: o pior caso é uma frase velha na
                     * fatura, não dinheiro errado.
                     *
                     * A data **não** se move: o cliente pagou o período e usa o
                     * período. Quem pagou doze meses passa a ser cobrado por mês
                     * só quando o ano acabar.
                     */
                    if (mudaDeCiclo) {
                        try {
                            await trocarCicloNoGateway({
                                subscriptionId: assinatura.asaasSubscriptionId,
                                ciclo,
                                value: valorNovo,
                                nextDueDate: fimDaCobranca ?? proximaCobranca(cicloAtual),
                            })
                        } catch (erro) {
                            console.error(
                                `[CHANGE_PLAN] conta ${accountId}: o gateway recusou a troca de ` +
                                    `ciclo para ${ciclo}. Nada foi alterado. ${String(erro)}`
                            )
                            return NextResponse.json(
                                {
                                    error:
                                        'Não conseguimos mudar o ciclo da cobrança no gateway ' +
                                        'agora, e por isso nada foi alterado — tentar de novo em ' +
                                        'instantes evita que você fique num ciclo aqui e noutro lá.',
                                },
                                { status: 502 }
                            )
                        }
                    }

                    await aplicarPlano({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        plan,
                        ciclo,
                        somenteRegistro: true,
                    })

                    try {
                        await descreverAssinatura({
                            accountId,
                            subscriptionId: assinatura.asaasSubscriptionId,
                            value: valorNovo,
                        })
                    } catch (erro) {
                        console.error(
                            `[CHANGE_PLAN] conta ${accountId} desceu para ${plan} mas o valor ` +
                                `da assinatura no Asaas não mudou: ${String(erro)}`
                        )
                    }

                    const virada = (fimDaCobranca ?? assinatura.currentPeriodEnd)?.toLocaleDateString(
                        'pt-BR',
                        { timeZone: 'America/Sao_Paulo' }
                    )

                    return NextResponse.json({
                        success: true,
                        pago: false,
                        message:
                            (mudaDeCiclo
                                ? `Assinatura ${CICLOS[ciclo].label.toLowerCase()} a partir da ` +
                                  `renovação, no ${planConfig.name}.`
                                : `Plano alterado para ${planConfig.name}.`) +
                            ` Nada foi cobrado agora — você continua com os recursos do plano ` +
                            `atual até ${virada ?? 'a renovação'}, quando o novo preço passa a valer.`,
                    })
                }

                /**
                 * O documento é obrigatório **aqui**, e não no cadastro.
                 *
                 * O Asaas exige `cpfCnpj` para o pagador, e a avaliação de 7
                 * dias não pede documento nenhum de propósito — pedir no
                 * cadastro é atrito antes de a clínica ver o produto. Então a
                 * exigência nasce no momento em que ela vai pagar.
                 */
                const conta = await prisma.account.findUnique({
                    where: { id: accountId },
                    select: {
                        name: true,
                        cpfCnpj: true,
                        asaasCustomerId: true,
                        postalCode: true,
                        address: true,
                        addressNumber: true,
                        province: true,
                        city: true,
                        state: true,
                        billingPhone: true,
                    },
                })

                /**
                 * **E agora a recusa não manda ninguém para outra tela.**
                 *
                 * O texto anterior era um roteiro de navegação — "Gerenciamento →
                 * Conta → Assinatura → Comprar adicionais" — e a tela o
                 * transformava num atalho para a guia da empresa, onde a pessoa
                 * preenchia, voltava e começava de novo. Era a queixa do Andre em
                 * 2026-11-07.
                 *
                 * O que mudou: a resposta diz **o que falta**, campo por campo, e
                 * a tela abre o formulário ali mesmo, retomando a contratação ao
                 * gravar. O 409 continua existindo para a corrida (dois cliques,
                 * duas abas) e para quem chama a rota direto.
                 *
                 * E a exigência agora é o **conjunto**, não só o documento: o
                 * Asaas recusa `customerData` pela metade, então endereço
                 * incompleto significa o cliente redigitando na página deles o que
                 * já digitou na nossa. Ver `dados-de-cobranca.ts`.
                 */
                if (!conta) {
                    return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })
                }

                const faltaNaCobranca = conferirCobranca(conta)
                const pagador = cobrancaCompleta(conta)

                if (!pagador) {
                    return NextResponse.json(
                        {
                            error:
                                `Antes de contratar, complete os dados de cobrança — falta ` +
                                `${listarFaltantes(faltaNaCobranca.faltando)}.`,
                            faltaDocumento: true,
                            faltando: faltaNaCobranca.faltando,
                        },
                        { status: 409 }
                    )
                }

                /**
                 * O endereço de cobrança vem da conta, como o documento.
                 *
                 * Se estiver completo, `criarCheckoutDePlano` manda tudo e o
                 * cliente não redigita nada; faltando qualquer peça, ela omite
                 * `customerData` inteiro e a página do Asaas pergunta — porque
                 * metade é o único envio que o Asaas recusa. Ver a tabela lá.
                 */

                /**
                 * Subir de plano cobra só a diferença dos dias que faltam.
                 *
                 * E quando a diferença fica abaixo do mínimo do Asaas (R$ 5) —
                 * um upgrade a três dias da renovação, por exemplo —, o plano
                 * entra **sem cobrança**: forçar R$ 5 por uma diferença de R$ 3
                 * é cobrar a mais para respeitar um limite do gateway, e a
                 * diferença some na renovação cheia, que é logo ali.
                 */
                /**
                 * A cobrança avulsa, quando há uma: upgrade ou troca de ciclo.
                 *
                 * Os dois casos cobram **agora** sobre uma assinatura que já
                 * existe, e por isso seguem o mesmo caminho — cobrança DETACHED,
                 * aplicação no webhook, `PUT` no valor da recorrência. Era um
                 * `if` só do upgrade; passar a ser uma pergunta sobre a direção
                 * é o que deixou a troca de ciclo nascer sem um segundo
                 * mecanismo.
                 *
                 * `adicionais` conta o que **não foi cancelado**: o cancelado
                 * ainda vale até a renovação (capacidade), mas não entra em
                 * fatura nenhuma a partir dela.
                 */
                const proporcional =
                    direcao === 'upgrade' || direcao === 'novo-ciclo' ? aCobrar : null

                if (proporcional?.abaixoDoMinimo && assinatura?.asaasSubscriptionId) {
                    const { notas } = await aplicarPlano({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        plan,
                        ciclo,
                    })

                    try {
                        await descreverAssinatura({
                            accountId,
                            subscriptionId: assinatura.asaasSubscriptionId,
                            value: valorDaFatura(plan, unidades.cobraveis, ciclo),
                        })
                    } catch (erro) {
                        console.error(`[CHANGE_PLAN] valor da assinatura não atualizado: ${String(erro)}`)
                    }

                    return NextResponse.json({
                        success: true,
                        pago: false,
                        message:
                            `Plano alterado para ${planConfig.name} sem cobrança: faltam ` +
                            `${proporcional.diasRestantes} dia(s) para a renovação e a diferença ` +
                            `ficou abaixo do mínimo.` + (notas.length ? ` ${notas.join('; ')}.` : ''),
                    })
                }

                try {
                    const { link } = await criarCheckoutDePlano({
                        accountId,
                        plan,
                        ciclo,
                        adicionais: unidades.cobraveis,
                        asaasCustomerId: conta.asaasCustomerId,
                        ...(proporcional ? { valorProporcional: proporcional.valor } : {}),
                        pagador: {
                            name: conta.name,
                            email: user.email ?? '',
                            phone: pagador.billingPhone,
                            cpfCnpj: pagador.cpfCnpj,
                            address: pagador.address,
                            addressNumber: pagador.addressNumber,
                            province: pagador.province,
                            postalCode: pagador.postalCode,
                        },
                        baseUrl: baseDaAplicacao(request),
                    })

                    return NextResponse.json({
                        success: true,
                        pago: true,
                        /** A tela manda o pagador para cá. */
                        link,
                        message:
                            direcao === 'novo-ciclo'
                                ? `Abrindo o pagamento dos 12 meses do ${planConfig.name}, ` +
                                  `com o saldo dos ${proporcional?.diasRestantes ?? 0} dia(s) que ` +
                                  `faltam do período atual já descontado.`
                                : proporcional
                                  ? `Abrindo o pagamento da diferença até a renovação ` +
                                    `(${proporcional.diasRestantes} dia(s)).`
                                  : `Abrindo o pagamento do ${planConfig.name} ` +
                                    `${CICLOS[ciclo].label.toLowerCase()}.`,
                    })
                } catch (erro) {
                    console.error('[CHANGE_PLAN] falha ao criar checkout', erro)
                    return NextResponse.json(
                        {
                            error:
                                erro instanceof AsaasError
                                    ? `O gateway recusou: ${erro.detalhe}`
                                    : 'Não foi possível abrir o pagamento agora. Tente de novo em instantes.',
                        },
                        { status: 502 }
                    )
                }
            }

            /**
             * Compra adicionais: crédito avulso, unidades, ou os dois juntos.
             *
             * Um caso para os dois porque a tela virou uma: o cliente escolhe o
             * pacote de crédito **e** quantas unidades no mesmo diálogo, e
             * clicar em "Comprar adicionais" não pode gravar metade.
             *
             * AS DUAS NATUREZAS NÃO SE MISTURAM
             *
             * Crédito é **cobrança única** com 90 dias de validade — recarga que
             * se repete todo mês é upgrade de plano com outro nome. Unidade é
             * **recorrente**: soma R$ 290 à mensalidade enquanto existir, que é
             * o que mantém a escada honesta (R$ 890 do Multiclínica são 3 × R$
             * 297). Decisão do Andre em 2026-10-18.
             *
             * Por isso a resposta devolve os dois valores separados, e a tela
             * mostra dois subtotais em vez de uma soma que não existe.
             */
            case 'buy-addons': {
                const accountId = await accountIdOf(workspaceUser.workspaceId)
                if (!accountId) {
                    return NextResponse.json(
                        { error: 'Conta não encontrada para este workspace' },
                        { status: 404 }
                    )
                }

                /**
                 * Mesmo portão do crédito avulso desde sempre: plano ativo e
                 * fora da avaliação. Sem os dois, a clínica rodaria
                 * indefinidamente de adicional em adicional sem nunca assinar —
                 * que é a regra inteira.
                 */
                const state = await getBillingState(workspaceUser.workspaceId)
                const permitido = canBuyAddons(state)
                if (!permitido.ok) {
                    return NextResponse.json({ error: permitido.reason }, { status: 402 })
                }

                /**
                 * Plano cancelado ainda opera até o fim do ciclo — e por isso
                 * `canBuyAddons` o considera ativo —, mas ele **não renova**.
                 * Vender um adicional recorrente aí seria cobrar por algo que
                 * não tem próximo ciclo onde existir.
                 */
                const assinaturaViva = await prisma.subscription.findUnique({
                    where: { accountId },
                    select: { status: true },
                })

                if (assinaturaViva?.status === 'canceled') {
                    return NextResponse.json(
                        {
                            error:
                                'Sua assinatura está cancelada e não será renovada. ' +
                                'Contrate um plano para voltar a comprar adicionais.',
                        },
                        { status: 409 }
                    )
                }

                /**
                 * O pacote de crédito vem da lista fechada, e o preço vem dela.
                 *
                 * A rota aceitava qualquer quantidade e multiplicava por um
                 * preço unitário: quem postasse `quantity: 1000000` levava um
                 * milhão de créditos ao preço de tabela, sem que nenhum desconto
                 * de volume tivesse sido decidido para aquele tamanho.
                 */
                const pack = data.credits ? creditPackFor(data.credits) : null
                if (data.credits && !pack) {
                    return NextResponse.json(
                        { error: 'Pacote de créditos inválido.' },
                        { status: 400 }
                    )
                }

                /**
                 * O teto de 10 unidades por compra não é regra de negócio — é
                 * guarda contra o dedo escorregando no contador. Dez unidades
                 * são R$ 2.900 por mês somados à mensalidade de uma vez, e quem
                 * precisa de mais que isso está numa conversa comercial, não num
                 * contador de tela.
                 */
                const unidadesPedidas = Number(data.units) || 0
                if (!Number.isInteger(unidadesPedidas) || unidadesPedidas < 0 || unidadesPedidas > 10) {
                    return NextResponse.json(
                        { error: 'Escolha de 1 a 10 unidades adicionais por compra.' },
                        { status: 400 }
                    )
                }

                /**
                 * O treinamento, com o mesmo tipo de guarda da unidade.
                 *
                 * O teto por compra é de tela, não de negócio: cinco
                 * treinamentos são R$ 12.000 de uma vez, e quem precisa de mais
                 * está numa conversa comercial. **O preço é lido aqui**, do
                 * catálogo, e nunca do corpo da requisição — preço que chega pelo
                 * cliente é preço que o cliente escolhe.
                 */
                const treinamentosPedidos = Number(data.trainings) || 0
                if (
                    !Number.isInteger(treinamentosPedidos) ||
                    treinamentosPedidos < 0 ||
                    treinamentosPedidos > TREINAMENTO.maximoPorCompra
                ) {
                    return NextResponse.json(
                        {
                            error:
                                `Escolha de 1 a ${TREINAMENTO.maximoPorCompra} treinamentos de ` +
                                'agente por compra.',
                        },
                        { status: 400 }
                    )
                }

                const precoUnitarioDoTreinamento = precoDoTreinamento().valor
                const valorDosTreinamentos = treinamentosPedidos * precoUnitarioDoTreinamento

                if (!pack && unidadesPedidas === 0 && treinamentosPedidos === 0) {
                    return NextResponse.json(
                        {
                            error:
                                'Escolha um pacote de créditos, uma unidade adicional ou um ' +
                                'treinamento de agente.',
                        },
                        { status: 400 }
                    )
                }

                /**
                 * O que a cesta custa agora.
                 *
                 * O pacote de crédito é compra única e vai pelo preço de
                 * tabela. A unidade é **recorrente**, e por isso entra
                 * proporcional aos dias que faltam do ciclo já pago: ela passa a
                 * valer hoje e a renovação já vai cobrar o mês inteiro dela.
                 * Cobrar R$ 290 cheios no dia 28 seria cobrar duas vezes os
                 * mesmos dois dias — a mesma regra do upgrade de plano.
                 */
                const assinatura = await prisma.subscription.findUnique({
                    where: { accountId },
                    select: {
                        plan: true,
                        asaasSubscriptionId: true,
                        currentPeriodStart: true,
                        currentPeriodEnd: true,
                    },
                })

                const proporcional = proporcionalDoAdicional({
                    unidades: unidadesPedidas,
                    inicioDoCiclo: assinatura?.currentPeriodStart ?? null,
                    fimDoCiclo: assinatura?.currentPeriodEnd ?? null,
                    agora: new Date(),
                })

                const unidadesDepois = await unidadesDaConta(accountId)
                const planoVigente = isPlanId(assinatura?.plan) ? assinatura.plan : 'flow'

                const regime = await regimeDaConta(accountId)

                /**
                 * A conta isenta recebe na hora, sem passar pelo gateway.
                 *
                 * Vitalícia ou antes da data de início: mandar essa conta para
                 * um checkout de R$ 0,00 seria inventar uma cobrança que a
                 * decisão do produto diz que não existe.
                 */
                if (!regime.precisaPagar) {
                    const entregue = await aplicarAdicionais({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        packCredits: pack?.credits ?? null,
                        packPriceCents: pack ? Math.round(pack.price * 100) : null,
                        units: unidadesPedidas,
                        trainings: treinamentosPedidos,
                    })

                    const [depois, unidades] = await Promise.all([
                        getBillingState(workspaceUser.workspaceId),
                        unidadesDaConta(accountId),
                    ])

                    const porque =
                        regime.motivo === 'vitalicia'
                            ? 'Conta vitalícia: nada foi cobrado.'
                            : `A cobrança desta conta começa em ${regime.a_partir_de?.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`

                    return NextResponse.json({
                        success: true,
                        pago: false,
                        message: `${resumoDaCesta(pack ?? null, unidadesPedidas, unidades.max, treinamentosPedidos)} ${porque}`,
                        creditsAdded: entregue.creditosAdicionados,
                        unidadesAdicionadas: entregue.unidadesAdicionadas,
                        treinamentosAdicionados: entregue.treinamentosAdicionados,
                        newTotal: depois.credits.available,
                        unidades,
                    })
                }

                /**
                 * Cesta abaixo do mínimo do Asaas entra de graça.
                 *
                 * Acontece na véspera da renovação: um dia de R$ 290 são
                 * R$ 9,67, dois dias de meia unidade podem ficar abaixo dos
                 * R$ 5 que o gateway aceita por cobrança. Forçar uma cobrança
                 * de R$ 5 por R$ 3 é cobrar a mais para respeitar um limite do
                 * gateway — e a diferença some na renovação, que é logo ali.
                 *
                 * Mesma decisão do upgrade de plano, e de propósito: duas
                 * regras diferentes para o mesmo limite seria o tipo de
                 * divergência que ninguém encontra até um cliente reclamar.
                 */
                const totalDaCesta =
                    (pack?.price ?? 0) + proporcional.valor + valorDosTreinamentos

                if (totalDaCesta < MINIMO_DO_ASAAS) {
                    const entregue = await aplicarAdicionais({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        packCredits: pack?.credits ?? null,
                        packPriceCents: pack ? Math.round(pack.price * 100) : null,
                        units: unidadesPedidas,
                        trainings: treinamentosPedidos,
                    })

                    if (unidadesPedidas > 0 && assinatura?.asaasSubscriptionId) {
                        await sincronizarValorDaAssinatura(accountId, assinatura.asaasSubscriptionId)
                    }

                    const [depois, unidades] = await Promise.all([
                        getBillingState(workspaceUser.workspaceId),
                        unidadesDaConta(accountId),
                    ])

                    return NextResponse.json({
                        success: true,
                        pago: false,
                        message:
                            `${resumoDaCesta(pack ?? null, unidadesPedidas, unidades.max, treinamentosPedidos)} ` +
                            `Faltam ${proporcional.diasRestantes} dia(s) para a renovação e o ` +
                            `proporcional ficou abaixo do mínimo, então nada foi cobrado agora.`,
                        creditsAdded: entregue.creditosAdicionados,
                        unidadesAdicionadas: entregue.unidadesAdicionadas,
                        treinamentosAdicionados: entregue.treinamentosAdicionados,
                        newTotal: depois.credits.available,
                        unidades,
                    })
                }

                /**
                 * Comprar unidade exige assinatura viva no Asaas.
                 *
                 * O valor da recorrência sobe depois do pagamento, e sem
                 * `asaasSubscriptionId` não há o que subir: a unidade seria
                 * cobrada uma vez, proporcional, e nunca mais. Melhor recusar
                 * com a razão do que vender algo que não renova.
                 */
                if (unidadesPedidas > 0 && !assinatura?.asaasSubscriptionId) {
                    return NextResponse.json(
                        {
                            error:
                                'A unidade adicional soma à sua mensalidade, e esta conta ainda não ' +
                                'tem assinatura ativa no gateway. Contrate ou renove o plano antes.',
                        },
                        { status: 409 }
                    )
                }

                const conta = await prisma.account.findUnique({
                    where: { id: accountId },
                    select: {
                        name: true,
                        cpfCnpj: true,
                        asaasCustomerId: true,
                        billingPhone: true,
                        address: true,
                        addressNumber: true,
                        province: true,
                        postalCode: true,
                    },
                })

                /**
                 * Mesma exigência da contratação, e pela mesma razão.
                 *
                 * Era só o documento, e o texto mandava a pessoa para outra guia
                 * — o caminho que o Andre pediu para acabar em 2026-11-07. A
                 * resposta agora diz o que falta, campo por campo, e a tela abre
                 * o formulário sem sair daqui.
                 */
                if (!conta) {
                    return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })
                }

                const pagador = cobrancaCompleta(conta)

                if (!pagador) {
                    const falta = conferirCobranca(conta)
                    return NextResponse.json(
                        {
                            error:
                                `Antes de comprar, complete os dados de cobrança — falta ` +
                                `${listarFaltantes(falta.faltando)}.`,
                            faltaDocumento: true,
                            faltando: falta.faltando,
                        },
                        { status: 409 }
                    )
                }

                /**
                 * Cartão já conhecido: cobra direto, sem checkout.
                 *
                 * A página do Asaas não sugere o cartão salvo — ela não sabe o
                 * que nós sabemos — e o cliente redigitava o número a cada
                 * compra. Com o token guardado, a compra vira uma chamada e o
                 * PAN continua fora daqui.
                 *
                 * O token vem da tela, então é entrada não confiável: tem de
                 * ser um cartão **desta conta**.
                 */
                const tokenPedido = typeof data.cardToken === 'string' ? data.cardToken : ''

                if (tokenPedido) {
                    const cartao = await prisma.paymentCard.findFirst({
                        where: { accountId, asaasToken: tokenPedido },
                        select: { asaasToken: true, brand: true, last4: true },
                    })

                    if (!cartao) {
                        return NextResponse.json(
                            { error: 'Cartão não encontrado nesta conta.' },
                            { status: 404 }
                        )
                    }

                    if (!conta.asaasCustomerId) {
                        return NextResponse.json(
                            {
                                error:
                                    'Esta conta ainda não está ligada ao gateway. ' +
                                    'Use o checkout desta vez.',
                            },
                            { status: 409 }
                        )
                    }

                    try {
                        const cobranca = await cobrarNoCartaoSalvo({
                            accountId,
                            workspaceId: workspaceUser.workspaceId,
                            plan: planoVigente,
                            asaasCustomerId: conta.asaasCustomerId,
                            creditCardToken: cartao.asaasToken,
                            valor: totalDaCesta,
                            descricao: resumoDaCesta(
                                pack ?? null,
                                unidadesPedidas,
                                unidadesDepois.max,
                                treinamentosPedidos
                            ),
                            pacote: pack ? { credits: pack.credits, price: pack.price } : null,
                            unidades: unidadesPedidas,
                            treinamentos: treinamentosPedidos,
                        })

                        /**
                         * Cartão confirma na hora, então a entrega acontece
                         * aqui — com a mesma trava do webhook (`appliedAt`),
                         * que é quem cuida do caso em que o Asaas devolve
                         * pendente e confirma depois.
                         */
                        if (cobranca.confirmado) {
                            const entregue = await aplicarAdicionais({
                                accountId,
                                workspaceId: workspaceUser.workspaceId,
                                packCredits: pack?.credits ?? null,
                                packPriceCents: pack ? Math.round(pack.price * 100) : null,
                                units: unidadesPedidas,
                                trainings: treinamentosPedidos,
                            })

                            await prisma.asaasCheckout.update({
                                where: { id: cobranca.tentativaId },
                                data: { appliedAt: new Date() },
                            })

                            if (entregue.unidadesAdicionadas > 0 && assinatura?.asaasSubscriptionId) {
                                try {
                                    await sincronizarValorDaAssinatura(
                                        accountId,
                                        assinatura.asaasSubscriptionId
                                    )
                                } catch (erro) {
                                    console.error(
                                        `[BUY_ADDONS] ATENÇÃO: conta ${accountId} comprou unidade ` +
                                            `no cartão salvo e a mensalidade não subiu. ${String(erro)}`
                                    )
                                }
                            }

                            const [depois, unidades] = await Promise.all([
                                getBillingState(workspaceUser.workspaceId),
                                unidadesDaConta(accountId),
                            ])

                            return NextResponse.json({
                                success: true,
                                pago: false,
                                message:
                                    `${resumoDaCesta(pack ?? null, unidadesPedidas, unidades.max, treinamentosPedidos)} ` +
                                    `Cobrado ${formatPrice(totalDaCesta)} no ${cartao.brand ?? 'cartão'} ` +
                                    `••••${cartao.last4 ?? ''}.`,
                                creditsAdded: entregue.creditosAdicionados,
                                unidadesAdicionadas: entregue.unidadesAdicionadas,
                                treinamentosAdicionados: entregue.treinamentosAdicionados,
                                newTotal: depois.credits.available,
                                unidades,
                            })
                        }

                        return NextResponse.json({
                            success: true,
                            pago: false,
                            message:
                                `Cobrança de ${formatPrice(totalDaCesta)} enviada ao cartão ` +
                                `••••${cartao.last4 ?? ''}. Assim que o banco confirmar, o ` +
                                'adicional entra — a tela se atualiza sozinha.',
                            unidades: unidadesDepois,
                        })
                    } catch (erro) {
                        console.error('[BUY_ADDONS] cartão salvo recusado', erro)
                        return NextResponse.json(
                            {
                                error:
                                    erro instanceof AsaasError
                                        ? `O cartão foi recusado: ${erro.detalhe}`
                                        : 'Não foi possível cobrar o cartão salvo.',
                            },
                            { status: 502 }
                        )
                    }
                }

                try {
                    const { link } = await criarCheckoutDeAdicionais({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        plan: planoVigente,
                        pacote: pack ? { credits: pack.credits, price: pack.price } : null,
                        unidades: unidadesPedidas,
                        valorDasUnidades: proporcional.valor,
                        treinamentos: treinamentosPedidos,
                        precoDoTreinamento: precoUnitarioDoTreinamento,
                        asaasCustomerId: conta.asaasCustomerId,
                        pagador: {
                            name: conta.name,
                            email: user.email ?? '',
                            phone: pagador.billingPhone,
                            cpfCnpj: pagador.cpfCnpj,
                            address: pagador.address,
                            addressNumber: pagador.addressNumber,
                            province: pagador.province,
                            postalCode: pagador.postalCode,
                        },
                        baseUrl: baseDaAplicacao(request),
                    })

                    return NextResponse.json({
                        success: true,
                        pago: true,
                        link,
                        message:
                            unidadesPedidas > 0 && proporcional.valor > 0
                                ? `Abrindo o pagamento. A unidade entra proporcional aos ` +
                                  `${proporcional.diasRestantes} dia(s) que faltam e passa a somar ` +
                                  `R$ ${(unidadesPedidas * UNIDADE_ADICIONAL.price).toFixed(2)} por mês na renovação.`
                                : treinamentosPedidos > 0 && !pack
                                  ? 'Abrindo o pagamento do treinamento de agente.'
                                  : 'Abrindo o pagamento dos créditos.',
                        unidades: unidadesDepois,
                    })
                } catch (erro) {
                    console.error('[BUY_ADDONS] falha ao criar checkout', erro)
                    return NextResponse.json(
                        {
                            error:
                                erro instanceof AsaasError
                                    ? `O gateway recusou: ${erro.detalhe}`
                                    : 'Não foi possível abrir o pagamento agora. Tente de novo em instantes.',
                        },
                        { status: 502 }
                    )
                }
            }

            /**
             * Cancela unidades adicionais — uma, algumas, ou todas.
             *
             * **É direito do cliente, e só dele.** O upgrade de plano que passa
             * a cobrir a unidade não cancela o adicional sozinho: contrato à
             * parte se encerra por decisão de quem assinou, e cancelar em nome
             * dele "porque agora está incluso" é decidir sobre o dinheiro dos
             * outros. Decisão do Andre, e é por isso que esta ação existe.
             *
             * O cancelamento **não é retroativo**: o ciclo foi pago e a unidade
             * vale até a renovação. O que muda hoje é o valor da recorrência
             * para os ciclos seguintes.
             */
            /**
             * Troca o cartão que paga a mensalidade.
             *
             * **Sem o número do cartão.** O que vai para o Asaas é um
             * `creditCardToken` que ele já conhece — medido lá: `PUT
             * /subscriptions/{id}/creditCard` aceita ou o cartão inteiro, que
             * levaria o PAN para dentro desta aplicação e dos nossos logs, ou
             * um token. Com o token, o escopo de PCI continua sendo SAQ A, que
             * é a mesma razão de o checkout ser hospedado.
             *
             * O preço desse desenho é que só dá para escolher entre cartões que
             * **já pagaram** alguma coisa — um cartão novo entra pagando, na
             * página do Asaas. É o que a tela explica.
             */
            case 'set-card': {
                const accountId = await accountIdOf(workspaceUser.workspaceId)
                if (!accountId) {
                    return NextResponse.json(
                        { error: 'Conta não encontrada para este workspace' },
                        { status: 404 }
                    )
                }

                const token = typeof data.token === 'string' ? data.token.trim() : ''
                if (!token) {
                    return NextResponse.json({ error: 'Escolha um cartão.' }, { status: 400 })
                }

                /**
                 * O cartão tem de ser **desta conta**.
                 *
                 * Sem esta conferência, um token copiado de outra clínica
                 * passaria a pagar a assinatura desta — e o dono do cartão
                 * descobriria pela fatura. O token vem do cliente, então ele é
                 * entrada não confiável como qualquer outra.
                 */
                const cartao = await prisma.paymentCard.findFirst({
                    where: { accountId, asaasToken: token },
                    select: { asaasToken: true, brand: true, last4: true },
                })

                if (!cartao) {
                    return NextResponse.json(
                        { error: 'Cartão não encontrado nesta conta.' },
                        { status: 404 }
                    )
                }

                const assinaturaDoCartao = await prisma.subscription.findUnique({
                    where: { accountId },
                    select: { asaasSubscriptionId: true },
                })

                if (!assinaturaDoCartao?.asaasSubscriptionId) {
                    return NextResponse.json(
                        {
                            error:
                                'Esta conta não tem assinatura ativa no gateway, então não há ' +
                                'cobrança recorrente para trocar de cartão.',
                        },
                        { status: 409 }
                    )
                }

                try {
                    await asaas(
                        `/subscriptions/${assinaturaDoCartao.asaasSubscriptionId}/creditCard`,
                        { method: 'PUT', body: { creditCardToken: cartao.asaasToken } }
                    )
                } catch (erro) {
                    console.error('[SET_CARD] o gateway recusou a troca', erro)
                    return NextResponse.json(
                        {
                            error:
                                erro instanceof AsaasError
                                    ? `O gateway recusou: ${erro.detalhe}`
                                    : 'Não foi possível trocar o cartão agora.',
                        },
                        { status: 502 }
                    )
                }

                /**
                 * O espelho só é escrito **depois** que o gateway aceitou.
                 *
                 * Na ordem inversa a tela mostraria o cartão novo enquanto a
                 * cobrança seguiria no antigo — e ninguém desconfiaria até a
                 * fatura.
                 */
                await prisma.$transaction([
                    /**
                     * O padrão é único por conta, e o banco garante isso com um
                     * índice parcial. Limpar antes de marcar é o que mantém a
                     * transação válida — e numa transação, porque entre as duas
                     * escritas a conta ficaria sem cartão padrão nenhum.
                     */
                    prisma.paymentCard.updateMany({
                        where: { accountId, isDefault: true },
                        data: { isDefault: false },
                    }),
                    prisma.paymentCard.update({
                        where: { asaasToken: cartao.asaasToken },
                        data: { isDefault: true },
                    }),
                    prisma.subscription.updateMany({
                        where: { accountId },
                        data: {
                            paymentMethod: {
                                type: 'credit_card',
                                brand: cartao.brand ?? '',
                                last4: cartao.last4 ?? '',
                            },
                        },
                    }),
                ])

                return NextResponse.json({
                    success: true,
                    message: `A mensalidade passa a ser cobrada no ${cartao.brand ?? 'cartão'} ••••${cartao.last4 ?? ''}.`,
                })
            }

            case 'cancel-addon': {
                const accountId = await accountIdOf(workspaceUser.workspaceId)
                if (!accountId) {
                    return NextResponse.json(
                        { error: 'Conta não encontrada para este workspace' },
                        { status: 404 }
                    )
                }

                const quantas = Number(data.units) || 1
                if (!Number.isInteger(quantas) || quantas < 1) {
                    return NextResponse.json(
                        { error: 'Informe quantas unidades adicionais cancelar.' },
                        { status: 400 }
                    )
                }

                const [assinatura, vivos, unidades] = await Promise.all([
                    prisma.subscription.findUnique({
                        where: { accountId },
                        select: { plan: true, asaasSubscriptionId: true, currentPeriodEnd: true },
                    }),
                    /**
                     * Só as que **ainda não foram canceladas**.
                     *
                     * Era `adicionaisVivos`, e cancelado continua vivo até a
                     * renovação: a tela mostrava a mesma vaga, o botão seguia
                     * ativo, e cada clique cancelava outra contratação em
                     * silêncio. Aconteceu duas vezes na homologação do Andre
                     * antes de alguém notar.
                     */
                    prisma.unitAddon.findMany({
                        where: { accountId, ...adicionaisCobraveis },
                        orderBy: { createdAt: 'desc' },
                        select: { id: true },
                    }),
                    unidadesDaConta(accountId),
                ])

                if (vivos.length === 0) {
                    return NextResponse.json(
                        {
                            error:
                                unidades.cancelados > 0
                                    ? 'Todas as contratações adicionais desta conta já foram canceladas.'
                                    : 'Esta conta não tem unidades adicionais contratadas.',
                        },
                        { status: 409 }
                    )
                }

                if (quantas > vivos.length) {
                    return NextResponse.json(
                        {
                            error: `Você tem ${vivos.length} contratação${vivos.length === 1 ? '' : 'ões'} adicional${vivos.length === 1 ? '' : 'is'} ainda ativa${vivos.length === 1 ? '' : 's'}.`,
                        },
                        { status: 409 }
                    )
                }

                /**
                 * Recusa quando a clínica ficaria com mais unidades do que cabe.
                 *
                 * O downgrade de plano pausa agente e desconecta número, que são
                 * reversíveis. Unidade não: ela tem agenda, pacientes e
                 * conversas, e "pausar uma clínica" não existe. Então o sistema
                 * não aceita o cancelamento que deixaria a conta por cima do
                 * teto — ele diz quantas sobram e deixa a decisão de apagar
                 * alguma coisa com quem é dono dela.
                 */
                const tetoDepois = tetoDeUnidades(assinatura?.plan, vivos.length - quantas)
                if (unidades.used > tetoDepois) {
                    return NextResponse.json(
                        {
                            error:
                                `Você tem ${unidades.used} unidade${unidades.used === 1 ? '' : 's'} cadastrada${unidades.used === 1 ? '' : 's'} e, ` +
                                `cancelando ${quantas} contratação, caberiam ${tetoDepois}. ` +
                                'Cancelar a contratação de uma unidade em funcionamento, ' +
                                'com agentes e conversas, é feito pelo suporte.',
                        },
                        { status: 409 }
                    )
                }

                /** As mais novas primeiro: a mais antiga é a que a clínica já organizou em volta. */
                const alvo = vivos.slice(0, quantas).map((a) => a.id)
                const fimDoCiclo = assinatura?.currentPeriodEnd ?? new Date()

                await prisma.unitAddon.updateMany({
                    where: { id: { in: alvo } },
                    data: { canceledAt: new Date(), endsAt: fimDoCiclo },
                })

                /**
                 * O valor da recorrência desce **agora**, e isso não cobra menos
                 * pelo ciclo em curso: `descreverAssinatura` não toca nas
                 * cobranças já geradas. O que muda é a próxima — que é a
                 * primeira em que a unidade não vale mais.
                 */
                let mensalidadeNova: number | null = null
                if (assinatura?.asaasSubscriptionId) {
                    try {
                        mensalidadeNova = await sincronizarValorDaAssinatura(
                            accountId,
                            assinatura.asaasSubscriptionId
                        )
                    } catch (erro) {
                        console.error(
                            `[CANCEL_ADDON] ATENÇÃO: conta ${accountId} cancelou ${quantas} ` +
                                `adicional(is) e o valor no gateway não desceu. ` +
                                `Ajuste à mão no painel do Asaas. ${String(erro)}`
                        )
                    }
                }

                const ate = fimDoCiclo.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

                return NextResponse.json({
                    success: true,
                    message:
                        `${quantas} contratação adicional cancelada. ` +
                        `A unidade continua disponível até ${ate}` +
                        (mensalidadeNova !== null
                            ? `, e a partir daí a mensalidade passa a ser ${formatPrice(mensalidadeNova)}.`
                            : '.'),
                    unidades: await unidadesDaConta(accountId),
                })
            }

            /**
             * Desfaz o cancelamento de uma contratação adicional.
             *
             * Existe porque o cancelamento **não é instantâneo**: a unidade
             * vale até a renovação, e até lá nada aconteceu de irreversível.
             * Sem este caminho, um clique errado só se consertava comprando de
             * novo — pagando outra vez pelo que ainda está pago.
             *
             * Desfaz a mais recente: é a que acabou de ser cancelada, que é o
             * caso que esta ação existe para resolver.
             */
            case 'restore-addon': {
                const accountId = await accountIdOf(workspaceUser.workspaceId)
                if (!accountId) {
                    return NextResponse.json(
                        { error: 'Conta não encontrada para este workspace' },
                        { status: 404 }
                    )
                }

                const cancelada = await prisma.unitAddon.findFirst({
                    where: { accountId, canceledAt: { not: null }, ...adicionaisVivos() },
                    orderBy: { canceledAt: 'desc' },
                    select: { id: true },
                })

                if (!cancelada) {
                    return NextResponse.json(
                        {
                            error:
                                'Não há contratação cancelada para restaurar. ' +
                                'Depois da renovação, o caminho é contratar de novo.',
                        },
                        { status: 409 }
                    )
                }

                await prisma.unitAddon.update({
                    where: { id: cancelada.id },
                    data: { canceledAt: null, endsAt: null },
                })

                const assinaturaRestaurada = await prisma.subscription.findUnique({
                    where: { accountId },
                    select: { asaasSubscriptionId: true },
                })

                let mensalidadeNova: number | null = null
                if (assinaturaRestaurada?.asaasSubscriptionId) {
                    try {
                        mensalidadeNova = await sincronizarValorDaAssinatura(
                            accountId,
                            assinaturaRestaurada.asaasSubscriptionId
                        )
                    } catch (erro) {
                        console.error(
                            `[RESTORE_ADDON] ATENÇÃO: conta ${accountId} restaurou uma ` +
                                `contratação e o valor no gateway não subiu de volta. ${String(erro)}`
                        )
                    }
                }

                return NextResponse.json({
                    success: true,
                    message:
                        'Contratação restaurada — ela volta a renovar normalmente' +
                        (mensalidadeNova !== null
                            ? `, e a mensalidade segue em ${formatPrice(mensalidadeNova)}.`
                            : '.'),
                    unidades: await unidadesDaConta(accountId),
                })
            }

            case 'cancel': {
                /**
                 * Cancelar é a operação mais cara da conta, e por isso pede o
                 * e-mail de quem está logado digitado à mão. A conferência é
                 * aqui, não só na tela: uma confirmação que só existe no
                 * navegador não protege nada — some com um fetch.
                 */
                const { confirmEmail } = data as { confirmEmail?: string }
                const typed = (confirmEmail ?? '').trim().toLowerCase()
                if (!typed || typed !== (user.email ?? '').trim().toLowerCase()) {
                    return NextResponse.json(
                        { error: 'Digite o e-mail da conta em uso para confirmar o cancelamento' },
                        { status: 400 }
                    )
                }

                const accountId = await accountIdOf(workspaceUser.workspaceId)
                if (!accountId) {
                    return NextResponse.json(
                        { error: 'Conta não encontrada para este workspace' },
                        { status: 404 }
                    )
                }

                const assinatura = await prisma.subscription.findUnique({
                    where: { accountId },
                    select: {
                        asaasSubscriptionId: true,
                        currentPeriodEnd: true,
                        renewsAt: true,
                        billingCycle: true,
                        status: true,
                    },
                })

                if (assinatura?.status === 'canceled') {
                    return NextResponse.json(
                        { error: 'Esta assinatura já está cancelada.' },
                        { status: 409 }
                    )
                }

                /**
                 * Cancelar no gateway **antes** de cancelar aqui.
                 *
                 * Na ordem inversa, uma falha do Asaas deixaria a tela dizendo
                 * "cancelada" enquanto a recorrência segue cobrando todo mês —
                 * e o cliente só descobriria pela fatura. Se o gateway recusa,
                 * nada muda aqui e a mensagem pede para tentar de novo: o
                 * estado continua coerente e a segunda tentativa é barata.
                 *
                 * `DELETE /subscriptions/{id}` encerra a recorrência sem mexer
                 * nas cobranças já geradas — o ciclo pago continua pago, que é
                 * exatamente o que a tela promete.
                 */
                if (assinatura?.asaasSubscriptionId) {
                    try {
                        await asaas(`/subscriptions/${assinatura.asaasSubscriptionId}`, {
                            method: 'DELETE',
                        })
                    } catch (erro) {
                        console.error(
                            `[CANCEL] não consegui encerrar a assinatura ` +
                                `${assinatura.asaasSubscriptionId} da conta ${accountId}`,
                            erro
                        )
                        return NextResponse.json(
                            {
                                error:
                                    'Não conseguimos encerrar a cobrança no gateway agora, e por ' +
                                    'isso nada foi cancelado — tentar de novo em instantes evita ' +
                                    'que você fique cancelado aqui e cobrado lá.',
                            },
                            { status: 502 }
                        )
                    }
                }

                /**
                 * Até quando o acesso vale: o fim do **período de cobrança**.
                 *
                 * `renewsAt` e não `currentPeriodEnd`, com queda para trás: quem
                 * pagou doze meses usa os doze meses, e usar a data da franquia
                 * encurtaria o acesso de uma assinatura anual para trinta dias —
                 * tirando até onze meses pagos.
                 */
                const fimDoCiclo =
                    assinatura?.renewsAt ?? assinatura?.currentPeriodEnd ?? new Date()

                /**
                 * Um instante só, usado nas duas atualizações.
                 *
                 * É o que liga os adicionais a **este** cancelamento: desfazer
                 * procura as linhas com exatamente este carimbo, e assim não
                 * ressuscita o adicional que o cliente havia cancelado à mão
                 * semanas antes.
                 */
                const agora = new Date()

                await prisma.$transaction(async (tx) => {
                    /**
                     * As cobranças futuras daquela assinatura morreram com ela
                     * no Asaas, e o espelho tem de acompanhar **agora**: o
                     * evento `PAYMENT_DELETED` pode não vir, e uma cobrança
                     * "em aberto" que não existe mais faz a tela oferecer um
                     * pagamento impossível.
                     */
                    if (assinatura?.asaasSubscriptionId) {
                        await tx.invoice.updateMany({
                            where: {
                                accountId,
                                asaasSubscriptionId: assinatura.asaasSubscriptionId,
                                status: { in: ['PENDING', 'OVERDUE'] },
                            },
                            data: { status: 'CANCELED' },
                        })
                    }

                    await tx.subscription.updateMany({
                        where: { accountId },
                        data: {
                            status: 'canceled',
                            canceledAt: agora,
                            pastDueSince: null,
                            graceEndsAt: null,
                            /**
                             * O ponteiro some junto: a recorrência foi apagada
                             * no Asaas, e um id que não existe mais lá é o tipo
                             * de resíduo que faz uma rotina futura dar `PUT`
                             * num recurso fantasma e registrar erro sem causa.
                             */
                            asaasSubscriptionId: null,
                        },
                    })

                    /**
                     * Os adicionais morrem com o plano, na mesma data.
                     *
                     * Eles são contratos à parte — só o cliente os cancela —,
                     * mas são adicionais **de uma assinatura**: sem ela não há
                     * o que somar nem a que fatura anexá-los. Marcá-los aqui é
                     * o que faz a contagem de unidades e a renovação pararem de
                     * considerá-los no dia certo, sem varredura nenhuma.
                     */
                    await tx.unitAddon.updateMany({
                        where: { accountId, ...adicionaisVivos() },
                        data: { canceledAt: agora, endsAt: fimDoCiclo },
                    })
                })

                const ate = fimDoCiclo.toLocaleDateString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                })

                return NextResponse.json({
                    success: true,
                    /**
                     * A tela precisa da data para desenhar a faixa — e a faixa
                     * é o conserto do que o Andre apontou: "ao cancelar só
                     * aparece um pop-up no rodapé". O aviso em toast desaparece
                     * em segundos; o estado da assinatura não pode desaparecer
                     * com ele.
                     */
                    canceledAt: agora,
                    currentPeriodEnd: fimDoCiclo,
                    podeDesfazer: true,
                    message:
                        `Assinatura cancelada. Nada mais será cobrado, e você usa o que já ` +
                        `pagou até ${ate}. Dá para desfazer enquanto este período não terminar.`,
                })
            }

            /**
             * **Desfazer o cancelamento** — a volta que não existia.
             *
             * O Andre apontou em 2026-11-07 que cancelar só produzia um aviso
             * no rodapé. Faltavam duas coisas: o estado na tela (ver `canceledAt`
             * na resposta do cancelamento) e esta — um caminho de volta enquanto
             * o período pago está correndo.
             *
             * ## Por que isto é mais que um `UPDATE`
             *
             * Cancelar faz `DELETE` na assinatura do Asaas, e lá não há volta: a
             * recorrência deixou de existir. Restaurar só o nosso registro
             * deixaria a conta **ativa e sem cobrança** — e o buraco não é
             * teórico: o cron renova a franquia de toda assinatura ativa, então a
             * clínica usaria o produto de graça até alguém notar. Por isso o
             * gateway vem primeiro, e sem cartão salvo esta ação recusa e manda
             * contratar (que é o caminho que cobra).
             *
             * ## O que volta
             *
             * O plano, o estado e **os adicionais que caíram neste
             * cancelamento** — achados pelo carimbo `canceledAt` que a transação
             * do cancelamento gravou nos dois lugares. O adicional que o cliente
             * havia cancelado antes, à mão, continua cancelado: ele não faz parte
             * desta decisão.
             */
            case 'resume': {
                const accountId = await accountIdOf(workspaceUser.workspaceId)
                if (!accountId) {
                    return NextResponse.json(
                        { error: 'Conta não encontrada para este workspace' },
                        { status: 404 }
                    )
                }

                const assinatura = await prisma.subscription.findUnique({
                    where: { accountId },
                    select: {
                        plan: true,
                        status: true,
                        canceledAt: true,
                        billingCycle: true,
                        renewsAt: true,
                        currentPeriodEnd: true,
                        asaasSubscriptionId: true,
                    },
                })

                if (!assinatura || assinatura.status !== 'canceled') {
                    return NextResponse.json(
                        { error: 'Esta assinatura não está cancelada.' },
                        { status: 409 }
                    )
                }

                const ate = assinatura.renewsAt ?? assinatura.currentPeriodEnd

                /**
                 * Passado o período pago, não há o que desfazer.
                 *
                 * O acesso já terminou e a conta está em somente-leitura; voltar
                 * atrás aqui daria um ciclo que ninguém pagou. O caminho é
                 * contratar, que cobra.
                 */
                if (!ate || ate.getTime() <= Date.now()) {
                    return NextResponse.json(
                        {
                            error:
                                'O período já pago terminou, então não há mais o que desfazer. ' +
                                'Use “Contratar plano” para voltar a assinar.',
                        },
                        { status: 409 }
                    )
                }

                const regime = await regimeDaConta(accountId)
                const ciclo = cicloDe(assinatura.billingCycle)
                const planoVigente = isPlanId(assinatura.plan) ? assinatura.plan : 'flow'

                /**
                 * A recorrência volta ao gateway **antes** de o banco mudar.
                 *
                 * Conta isenta não tem recorrência para recriar — e nunca teve.
                 */
                let novaAssinaturaNoAsaas: string | null = null

                if (regime.precisaPagar) {
                    const [conta, cartao] = await Promise.all([
                        prisma.account.findUnique({
                            where: { id: accountId },
                            select: { asaasCustomerId: true },
                        }),
                        prisma.paymentCard.findFirst({
                            where: { accountId },
                            orderBy: [{ isDefault: 'desc' }, { lastSeenAt: 'desc' }],
                            select: { asaasToken: true, brand: true, last4: true },
                        }),
                    ])

                    if (!conta?.asaasCustomerId || !cartao) {
                        return NextResponse.json(
                            {
                                error:
                                    'Para desfazer o cancelamento precisamos recriar a cobrança, ' +
                                    'e esta conta não tem cartão salvo. Use “Contratar plano” — ' +
                                    'o seu acesso atual continua valendo até ' +
                                    `${ate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
                                precisaContratar: true,
                            },
                            { status: 409 }
                        )
                    }

                    /**
                     * O valor conta os adicionais que **vão voltar**.
                     *
                     * Lidos pelo carimbo, antes da restauração: contar os vivos
                     * agora daria zero (o cancelamento os derrubou) e a
                     * recorrência nasceria sem eles — cobrando a menos todo mês
                     * por uma unidade que a clínica tem de pé.
                     */
                    const voltam = assinatura.canceledAt
                        ? await prisma.unitAddon.count({
                              where: { accountId, canceledAt: assinatura.canceledAt },
                          })
                        : 0

                    try {
                        novaAssinaturaNoAsaas = await recriarAssinatura({
                            accountId,
                            customerId: conta.asaasCustomerId,
                            creditCardToken: cartao.asaasToken,
                            ciclo,
                            value: valorDaFatura(planoVigente, voltam, ciclo),
                            nextDueDate: ate,
                        })
                    } catch (erro) {
                        console.error(
                            `[RESUME] conta ${accountId}: o gateway recusou recriar a ` +
                                `recorrência. Nada foi alterado. ${String(erro)}`
                        )
                        return NextResponse.json(
                            {
                                error:
                                    erro instanceof AsaasError
                                        ? `O gateway recusou: ${erro.detalhe}`
                                        : 'Não conseguimos recriar a cobrança agora, e por isso ' +
                                          'nada foi alterado. Tente de novo em instantes.',
                            },
                            { status: 502 }
                        )
                    }
                }

                await prisma.$transaction(async (tx) => {
                    if (assinatura.canceledAt) {
                        await tx.unitAddon.updateMany({
                            where: { accountId, canceledAt: assinatura.canceledAt },
                            data: { canceledAt: null, endsAt: null },
                        })
                    }

                    await tx.subscription.update({
                        where: { accountId },
                        data: {
                            status: 'active',
                            canceledAt: null,
                            asaasSubscriptionId: novaAssinaturaNoAsaas,
                        },
                    })
                })

                const unidades = await unidadesDaConta(accountId)

                console.info(
                    `[RESUME] conta ${accountId} voltou ao ${planoVigente} ` +
                        `(${ciclo}), próxima cobrança em ${ate.toISOString()}`
                )

                return NextResponse.json({
                    success: true,
                    message:
                        `Cancelamento desfeito: o ${planFor(planoVigente).name} continua ativo e a ` +
                        `próxima cobrança volta para ` +
                        `${ate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.` +
                        (unidades.adicionais > 0
                            ? ` ${unidades.adicionais} unidade(s) adicional(is) também voltaram.`
                            : ''),
                    unidades,
                })
            }

            case 'update-payment-method': {
                const { paymentMethod } = data

                await prisma.subscription.updateMany({
                    where: assinaturaDaUnidade(workspaceUser.workspaceId),
                    data: { paymentMethod }
                })

                return NextResponse.json({
                    success: true,
                    message: 'Forma de pagamento atualizada'
                })
            }

            default:
                return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
        }
    } catch (error) {
        console.error('[API] Error updating subscription:', error)
        return NextResponse.json({ error: 'Erro ao atualizar assinatura' }, { status: 500 })
    }
}
