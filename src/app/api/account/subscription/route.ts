import { PLAN_LIST, TRIAL, planFor } from '@/lib/plans'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// Plan configuration
const CREDIT_PRICE = 49.90 // per 1000 credits

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

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: {
                workspaceId: true,
                workspace: { select: { name: true } },
            }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const subscription = await prisma.subscription.findUnique({
            where: { workspaceId: workspaceUser.workspaceId }
        })

        if (!subscription) {
            // No subscription row means onboarding predates the step that
            // creates one. Say so rather than reporting a plan the workspace was
            // never actually put on.
            return NextResponse.json({
                plan: null,
                planName: null,
                workspaceName: workspaceUser.workspace?.name ?? null,
                status: 'none',
                maxAgents: 0,
                maxMessages: 0,
                maxWhatsAppNumbers: 0,
                credits: 0,
                creditsUsed: 0,
                paymentMethod: null,
                trialEndsAt: null,
                plans: PLANS,
                trial: TRIAL,
                creditPrice: CREDIT_PRICE,
            })
        }

        const planConfig = planFor(subscription.plan)

        return NextResponse.json({
            plan: subscription.plan,
            planName: planConfig.name,
            workspaceName: workspaceUser.workspace?.name ?? null,
            maxWhatsAppNumbers: subscription.maxWhatsAppNumbers,
            trial: TRIAL,
            status: subscription.status,
            maxAgents: subscription.maxAgents,
            maxMessages: subscription.maxMessages,
            credits: subscription.credits,
            creditsUsed: subscription.creditsUsed,
            paymentMethod: subscription.paymentMethod,
            trialEndsAt: subscription.trialEndsAt,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            plans: PLANS,
            creditPrice: CREDIT_PRICE,
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

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
        })

        if (!workspaceUser || !['OWNER', 'ADMIN'].includes(workspaceUser.role)) {
            return NextResponse.json({ error: 'Permissão negada' }, { status: 403 })
        }

        const body = await request.json()
        const { action, ...data } = body

        switch (action) {
            case 'change-plan': {
                const { plan } = data
                if (!PLANS[plan as keyof typeof PLANS]) {
                    return NextResponse.json({ error: 'Plano inválido' }, { status: 400 })
                }

                const planConfig = PLANS[plan as keyof typeof PLANS]

                const subscription = await prisma.subscription.upsert({
                    where: { workspaceId: workspaceUser.workspaceId },
                    create: {
                        workspaceId: workspaceUser.workspaceId,
                        plan,
                        status: 'active',
                        maxAgents: planConfig.maxAgents,
                        maxMessages: planConfig.maxMessages,
                        maxWhatsAppNumbers: planConfig.maxWhatsAppNumbers,
                        credits: planConfig.credits,
                        currentPeriodStart: new Date(),
                        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    },
                    update: {
                        plan,
                        status: 'active',
                        maxAgents: planConfig.maxAgents,
                        maxMessages: planConfig.maxMessages,
                        maxWhatsAppNumbers: planConfig.maxWhatsAppNumbers,
                        trialEndsAt: null,
                    }
                })

                return NextResponse.json({
                    success: true,
                    message: `Plano alterado para ${planConfig.name}`,
                    subscription
                })
            }

            case 'buy-credits': {
                const { quantity } = data
                const lots = Math.ceil(quantity / 1000)
                const creditsToAdd = lots * 1000
                const totalPrice = lots * CREDIT_PRICE

                const subscription = await prisma.subscription.update({
                    where: { workspaceId: workspaceUser.workspaceId },
                    data: {
                        credits: { increment: creditsToAdd }
                    }
                })

                return NextResponse.json({
                    success: true,
                    message: `${creditsToAdd} créditos adicionados por R$ ${totalPrice.toFixed(2)}`,
                    creditsAdded: creditsToAdd,
                    newTotal: subscription.credits,
                })
            }

            case 'cancel': {
                await prisma.subscription.update({
                    where: { workspaceId: workspaceUser.workspaceId },
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

                await prisma.subscription.update({
                    where: { workspaceId: workspaceUser.workspaceId },
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
