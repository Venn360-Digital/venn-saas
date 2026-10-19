import { CREDIT_PACKS, PLAN_LIST, TRIAL, UNIDADE_ADICIONAL, creditPackFor, formatPrice, planFor } from '@/lib/plans'
import { currentMembership } from '@/lib/auth/workspace'
import { canBuyAddons, getBillingState, spokenRepliesLeft } from '@/lib/billing'
import { isPlanId, limitesEfetivos, tetoDeUnidades } from '@/lib/plan-limits'
import { criarCheckoutDePlano, criarCheckoutDeAdicionais } from '@/lib/asaas/checkout'
import { regimeDaConta } from '@/lib/asaas/cobranca'
import { aplicarAdicionais } from '@/lib/billing/aplicar-adicionais'
import { AsaasError, asaas } from '@/lib/asaas/client'
import { aplicarPlano } from '@/lib/billing/aplicar-plano'
import { descreverAssinatura, sincronizarValorDaAssinatura } from '@/lib/asaas/vincular'
import { MINIMO_DO_ASAAS, diferencaProporcional, direcaoDaTroca, mensalidade, proporcionalDoAdicional } from '@/lib/billing/troca-de-plano'

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
import prisma from '@/lib/prisma'
import { accountIdOf, adicionaisCobraveis, adicionaisVivos, assinaturaDaUnidade, unidadesDaConta } from '@/lib/account'
import { createClient } from '@/lib/supabase/server'


/**
 * The plans as JSON. The shared definition carries Lucide components for the
 * channel row, which cannot be serialised, so the client imports those directly
 * and only the data travels.
 */
const PLANS = Object.fromEntries(
    PLAN_LIST.map((p) => [
        p.id,
        {
            name: p.name,
            icon: p.icon,
            iconDark: p.iconDark,
            description: p.description,
            price: p.price,
            badge: p.badge ?? null,
            features: p.features,
            ...p.limits,
        },
    ])
)

// GET /api/account/subscription - Get subscription details
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

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
                plans: PLANS,
                trial: TRIAL,
                creditPacks: CREDIT_PACKS,
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
            cartoes: accountId
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
            regime: accountId
                ? await regimeDaConta(accountId)
                : { precisaPagar: true, motivo: null, a_partir_de: null },
            pastDueSince: subscription.pastDueSince,
            plans: PLANS,
            creditPacks: CREDIT_PACKS,
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
    tetoDeUnidades: number
): string {
    const partes: string[] = []

    if (pack) {
        partes.push(`${pack.credits.toLocaleString('pt-BR')} créditos avulsos`)
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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

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
                const { plan } = data
                if (!isPlanId(plan)) {
                    return NextResponse.json({ error: 'Plano inválido' }, { status: 400 })
                }

                const planConfig = PLANS[plan]

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
                const cabe = tetoDeUnidades(plan, unidades.adicionais)
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
                    },
                })

                const temAssinaturaViva = Boolean(
                    assinatura?.asaasSubscriptionId && assinatura.status === 'active'
                )
                const direcao = direcaoDaTroca(
                    temAssinaturaViva && isPlanId(assinatura?.plan) ? assinatura.plan : null,
                    plan
                )

                if (!regime.precisaPagar) {
                    const { notas } = await aplicarPlano({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        plan,
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
                    await aplicarPlano({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        plan,
                        somenteRegistro: true,
                    })

                    try {
                        await descreverAssinatura({
                            accountId,
                            subscriptionId: assinatura.asaasSubscriptionId,
                            value: mensalidade(plan, unidades.adicionais),
                        })
                    } catch (erro) {
                        console.error(
                            `[CHANGE_PLAN] conta ${accountId} desceu para ${plan} mas o valor ` +
                                `da assinatura no Asaas não mudou: ${String(erro)}`
                        )
                    }

                    const virada = assinatura.currentPeriodEnd?.toLocaleDateString('pt-BR', {
                        timeZone: 'America/Sao_Paulo',
                    })

                    return NextResponse.json({
                        success: true,
                        pago: false,
                        message:
                            `Plano alterado para ${planConfig.name}. Nada foi cobrado agora — ` +
                            `você continua com os recursos do plano atual até ` +
                            `${virada ?? 'a renovação'}, quando o novo preço passa a valer.`,
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

                if (!conta?.cpfCnpj) {
                    return NextResponse.json(
                        {
                            error:
                                'Antes de contratar, informe o CPF ou CNPJ de cobrança em ' +
                                'Gerenciamento → Conta → Conta da Clínica.',
                            faltaDocumento: true,
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
                const proporcional =
                    direcao === 'upgrade' && isPlanId(assinatura?.plan)
                        ? diferencaProporcional({
                            atual: assinatura.plan,
                            novo: plan,
                            adicionais: unidades.adicionais,
                            inicioDoCiclo: assinatura.currentPeriodStart,
                            fimDoCiclo: assinatura.currentPeriodEnd,
                            agora: new Date(),
                        })
                        : null

                if (proporcional?.abaixoDoMinimo && assinatura?.asaasSubscriptionId) {
                    const { notas } = await aplicarPlano({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        plan,
                    })

                    try {
                        await descreverAssinatura({
                            accountId,
                            subscriptionId: assinatura.asaasSubscriptionId,
                            value: mensalidade(plan, unidades.adicionais),
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
                        adicionais: unidades.adicionais,
                        asaasCustomerId: conta.asaasCustomerId,
                        ...(proporcional ? { valorProporcional: proporcional.valor } : {}),
                        pagador: {
                            name: conta.name,
                            cpfCnpj: conta.cpfCnpj,
                            email: user.email ?? '',
                            phone: conta.billingPhone,
                            address: conta.address,
                            addressNumber: conta.addressNumber,
                            province: conta.province,
                            postalCode: conta.postalCode,
                        },
                        baseUrl: baseDaAplicacao(request),
                    })

                    return NextResponse.json({
                        success: true,
                        pago: true,
                        /** A tela manda o pagador para cá. */
                        link,
                        message: proporcional
                            ? `Abrindo o pagamento da diferença até a renovação ` +
                              `(${proporcional.diasRestantes} dia(s)).`
                            : `Abrindo o pagamento do ${planConfig.name}.`,
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

                if (!pack && unidadesPedidas === 0) {
                    return NextResponse.json(
                        { error: 'Escolha um pacote de créditos ou pelo menos uma unidade.' },
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
                        message: `${resumoDaCesta(pack ?? null, unidadesPedidas, unidades.max)} ${porque}`,
                        creditsAdded: entregue.creditosAdicionados,
                        unidadesAdicionadas: entregue.unidadesAdicionadas,
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
                const totalDaCesta = (pack?.price ?? 0) + proporcional.valor

                if (totalDaCesta < MINIMO_DO_ASAAS) {
                    const entregue = await aplicarAdicionais({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        packCredits: pack?.credits ?? null,
                        packPriceCents: pack ? Math.round(pack.price * 100) : null,
                        units: unidadesPedidas,
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
                            `${resumoDaCesta(pack ?? null, unidadesPedidas, unidades.max)} ` +
                            `Faltam ${proporcional.diasRestantes} dia(s) para a renovação e o ` +
                            `proporcional ficou abaixo do mínimo, então nada foi cobrado agora.`,
                        creditsAdded: entregue.creditosAdicionados,
                        unidadesAdicionadas: entregue.unidadesAdicionadas,
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

                if (!conta?.cpfCnpj) {
                    return NextResponse.json(
                        {
                            error:
                                'Informe o CPF ou CNPJ de cobrança em Conta da Clínica antes de comprar.',
                        },
                        { status: 409 }
                    )
                }

                try {
                    const { link } = await criarCheckoutDeAdicionais({
                        accountId,
                        workspaceId: workspaceUser.workspaceId,
                        plan: planoVigente,
                        pacote: pack ? { credits: pack.credits, price: pack.price } : null,
                        unidades: unidadesPedidas,
                        valorDasUnidades: proporcional.valor,
                        asaasCustomerId: conta.asaasCustomerId,
                        pagador: {
                            name: conta.name,
                            cpfCnpj: conta.cpfCnpj,
                            email: user.email ?? '',
                            phone: conta.billingPhone,
                            address: conta.address,
                            addressNumber: conta.addressNumber,
                            province: conta.province,
                            postalCode: conta.postalCode,
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
                                `Suspenda ${unidades.used - tetoDepois} unidade${unidades.used - tetoDepois === 1 ? '' : 's'} antes — ` +
                                'suspender tira a clínica do ar sem apagar nada.',
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
                    select: { asaasSubscriptionId: true, currentPeriodEnd: true },
                })

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

                const fimDoCiclo = assinatura?.currentPeriodEnd ?? new Date()

                await prisma.$transaction(async (tx) => {
                    await tx.subscription.updateMany({
                        where: { accountId },
                        data: {
                            status: 'canceled',
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
                        data: { canceledAt: new Date(), endsAt: fimDoCiclo },
                    })
                })

                const ate = fimDoCiclo.toLocaleDateString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                })

                return NextResponse.json({
                    success: true,
                    message:
                        `Assinatura cancelada. Nada mais será cobrado, e você usa o que já ` +
                        `pagou até ${ate}.`,
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
