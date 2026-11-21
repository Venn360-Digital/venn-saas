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
        const { name, description, sku, category, price, group, durationMinutes, groupId, unit, isActive } =
            body

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

        /**
         * O grupo informado é da unidade, e o nome dele vai para `group`.
         *
         * As duas colunas convivem: `group` é o que a coluna GERADA
         * `searchText` indexa, então gravar só a FK faria a busca por nome de
         * grupo parar de encontrar. Ver a mesma nota em `api/products`.
         */
        let grupo: { id: string; name: string } | null = null
        if (groupId) {
            grupo = await prisma.productGroup.findFirst({
                where: { id: groupId, workspaceId: workspaceUser.workspaceId },
                select: { id: true, name: true },
            })
            if (!grupo) {
                return NextResponse.json({ error: 'Grupo não encontrado' }, { status: 404 })
            }
        }

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
                ...(unit !== undefined && { unit }),
                ...(isActive !== undefined && { isActive }),
                // `groupId: null` desliga o vínculo e limpa o texto junto: deixar
                // o nome antigo em `group` faria a busca encontrar um grupo que
                // o item já não tem.
                ...(groupId !== undefined
                    ? grupo
                      ? { groupId: grupo.id, group: grupo.name }
                      : { groupId: null, group: null }
                    : {}),
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
