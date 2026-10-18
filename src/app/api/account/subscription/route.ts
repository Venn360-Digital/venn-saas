import { CREDIT_PACKS, PLAN_LIST, TRIAL, UNIDADE_ADICIONAL, creditPackFor, planFor } from '@/lib/plans'
import { currentMembership } from '@/lib/auth/workspace'
import {
    canBuyAddons,
    getBillingState,
    purchaseExpiry,
    spokenRepliesLeft,
} from '@/lib/billing'
import { isPlanId, tetoDeUnidades } from '@/lib/plan-limits'
import { criarCheckoutDePlano } from '@/lib/asaas/checkout'
import { regimeDaConta } from '@/lib/asaas/cobranca'
import { AsaasError } from '@/lib/asaas/client'
import { aplicarPlano } from '@/lib/billing/aplicar-plano'

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
import { accountIdOf, assinaturaDaUnidade, unidadesDaConta } from '@/lib/account'
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
            trialEndsAt: subscription.trialEndsAt,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            plans: PLANS,
            creditPacks: CREDIT_PACKS,
            /** Franquia e avulso somados, para o medidor não contradizer a sidebar. */
            creditos: estado.credits,
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
                 * O documento é obrigatório **aqui**, e não no cadastro.
                 *
                 * O Asaas exige `cpfCnpj` para o pagador, e a avaliação de 7
                 * dias não pede documento nenhum de propósito — pedir no
                 * cadastro é atrito antes de a clínica ver o produto. Então a
                 * exigência nasce no momento em que ela vai pagar.
                 */
                const conta = await prisma.account.findUnique({
                    where: { id: accountId },
                    select: { name: true, cpfCnpj: true },
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

                try {
                    const { link } = await criarCheckoutDePlano({
                        accountId,
                        plan,
                        adicionais: unidades.adicionais,
                        pagador: {
                            name: conta.name,
                            cpfCnpj: conta.cpfCnpj,
                            email: user.email ?? '',
                        },
                        baseUrl: baseDaAplicacao(request),
                    })

                    return NextResponse.json({
                        success: true,
                        pago: true,
                        /** A tela manda o pagador para cá. */
                        link,
                        message: `Abrindo o pagamento do ${planConfig.name}.`,
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

                const expiresAt = purchaseExpiry()

                // Numa transação: metade comprada é pior que nada comprado, e o
                // cliente clicou uma vez.
                await prisma.$transaction(async (tx) => {
                    if (pack) {
                        /**
                         * Lote próprio, com validade própria — não incremento da
                         * franquia do plano. A franquia é descartada na
                         * renovação, e crédito que a clínica pagou à parte não
                         * pode ir com ela.
                         */
                        await tx.creditPurchase.create({
                            data: {
                                workspaceId: workspaceUser.workspaceId,
                                amount: pack.credits,
                                priceCents: Math.round(pack.price * 100),
                                expiresAt,
                            },
                        })
                    }

                    /**
                     * Uma linha por unidade, e não uma linha com quantidade.
                     *
                     * O teto é derivado da contagem de linhas (ver
                     * `unidadesDaConta`), e cada linha guarda o preço cobrado
                     * naquele dia: se os R$ 290 mudarem, o que cada cliente paga
                     * continua escrito. Uma coluna de quantidade obrigaria a
                     * escolher entre um preço só para o lote ou um contador que
                     * divergiria das linhas.
                     */
                    if (unidadesPedidas > 0) {
                        await tx.unitAddon.createMany({
                            data: Array.from({ length: unidadesPedidas }, () => ({
                                accountId,
                                priceCents: Math.round(UNIDADE_ADICIONAL.price * 100),
                            })),
                        })
                    }
                })

                const [depois, unidades] = await Promise.all([
                    getBillingState(workspaceUser.workspaceId),
                    unidadesDaConta(accountId),
                ])

                const partes: string[] = []
                if (pack) {
                    partes.push(
                        `${pack.credits.toLocaleString('pt-BR')} créditos por R$ ${pack.price.toFixed(2)}, ` +
                            `válidos até ${expiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
                    )
                }
                if (unidadesPedidas > 0) {
                    const mensal = unidadesPedidas * UNIDADE_ADICIONAL.price
                    partes.push(
                        `${unidadesPedidas} unidade${unidadesPedidas === 1 ? '' : 's'} adicional${unidadesPedidas === 1 ? '' : 'is'} ` +
                            `por R$ ${mensal.toFixed(2)} por mês — você pode ter ${unidades.max} no total`
                    )
                }

                return NextResponse.json({
                    success: true,
                    message: `Contratado: ${partes.join('; ')}.`,
                    /** Separados de propósito: um é uma vez, o outro é por mês. */
                    cobradoAgoraCents: pack ? Math.round(pack.price * 100) : 0,
                    mensalidadeAdicionadaCents: Math.round(unidadesPedidas * UNIDADE_ADICIONAL.price * 100),
                    creditsAdded: pack?.credits ?? 0,
                    unidadesAdicionadas: unidadesPedidas,
                    newTotal: depois.credits.available,
                    unidades,
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

                await prisma.subscription.updateMany({
                    where: assinaturaDaUnidade(workspaceUser.workspaceId),
                    data: {
                        status: 'canceled',
                    }
                })

                return NextResponse.json({
                    success: true,
                    message: 'Assinatura cancelada. Você terá acesso até o fim do período atual.'
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
