import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { isSchedulable } from '@venn/core/lib/product-categories'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'

// PATCH - Update product
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
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
        const { name, description, sku, category, price, group, durationMinutes } = body

        /**
         * Duração só existe em servico.
         *
         * Mudar a categoria para "produto" tem que zerar a duração junto —
         * senão ela fica pendurada num creme dental, e a janela do profissional
         * passaria a oferecer um item que ninguém executa.
         */
        const categoriaFinal = category ?? existingProduct.category
        const duracao = isSchedulable(categoriaFinal)
            ? durationMinutes !== undefined
                ? durationMinutes
                : undefined
            : null

        const product = await prisma.productService.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(sku !== undefined && { sku }),
                ...(category !== undefined && { category }),
                ...(price !== undefined && { price }),
                ...(group !== undefined && { group }),
                ...(duracao !== undefined && { durationMinutes: duracao }),
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
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
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
