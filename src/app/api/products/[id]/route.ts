import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// PATCH - Update product
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const existingProduct = await prisma.productService.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingProduct) {
            return NextResponse.json({ error: 'Product not found' }, { status: 404 })
        }

        const body = await request.json()
        const { name, description, sku, category, price, group } = body

        const product = await prisma.productService.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(sku !== undefined && { sku }),
                ...(category !== undefined && { category }),
                ...(price !== undefined && { price }),
                ...(group !== undefined && { group }),
            }
        })

        return NextResponse.json(product)
    } catch (error) {
        console.error('[PRODUCTS_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove product
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const existingProduct = await prisma.productService.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingProduct) {
            return NextResponse.json({ error: 'Product not found' }, { status: 404 })
        }

        await prisma.productService.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[PRODUCTS_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
