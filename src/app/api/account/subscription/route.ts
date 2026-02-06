import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// Plan configuration
const PLANS = {
    flow: {
        name: 'Flow',
        price: 690,
        maxAgents: 1,
        maxMessages: 5000,
        credits: 5000,
    },
    pro: {
        name: 'Pro',
        price: 890,
        maxAgents: 2,
        maxMessages: 10000,
        credits: 10000,
    },
    advanced: {
        name: 'Advanced',
        price: 1290,
        maxAgents: 5,
        maxMessages: 20000,
        credits: 20000,
    },
}

const CREDIT_PRICE = 49.90 // per 1000 credits

// GET /api/account/subscription - Get subscription details
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const subscription = await prisma.subscription.findUnique({
            where: { workspaceId: workspaceUser.workspaceId }
        })

        if (!subscription) {
            // Return default free trial info
            return NextResponse.json({
                plan: 'pro',
                planName: 'Pro',
                status: 'trialing',
                maxAgents: 2,
                maxMessages: 10000,
                credits: 1000,
                creditsUsed: 0,
                paymentMethod: null,
                trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
                plans: PLANS,
                creditPrice: CREDIT_PRICE,
            })
        }

        const planConfig = PLANS[subscription.plan as keyof typeof PLANS] || PLANS.pro

        return NextResponse.json({
            plan: subscription.plan,
            planName: planConfig.name,
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
            where: { userId: user.id }
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
                        credits: planConfig.credits,
                        currentPeriodStart: new Date(),
                        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    },
                    update: {
                        plan,
                        status: 'active',
                        maxAgents: planConfig.maxAgents,
                        maxMessages: planConfig.maxMessages,
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
