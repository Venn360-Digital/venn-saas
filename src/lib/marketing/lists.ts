import 'server-only'
import { Prisma } from '#prisma'
import prisma from '@/lib/prisma'

/**
 * O filtro que origina uma lista de contatos — o mesmo vocabulário da tela de
 * Pacientes, num recorte enxuto (ver DUVIDAS-B2.md D4). Guardado em
 * `ContactList.filter` para a lista dinâmica reavaliar e para a estática dizer
 * de onde veio.
 */
export interface FiltroDeLista {
    tagId?: string | null
    originId?: string | null
    dealStatus?: string | null
    search?: string | null
    /** Exclui quem pediu para não receber automáticos. Padrão: true. */
    excluirOptOut?: boolean
}

/** Monta o `where` a partir do filtro, sempre preso ao workspace. */
function whereDoFiltro(workspaceId: string, filtro: FiltroDeLista): Prisma.ContactWhereInput {
    const and: Prisma.ContactWhereInput[] = [{ workspaceId }]

    // Broadcast precisa de número: contato sem telefone não recebe WhatsApp.
    and.push({ phone: { not: null } })

    if (filtro.excluirOptOut !== false) {
        and.push({ autoMessagesPausedAt: null })
    }
    if (filtro.tagId) {
        and.push({ tags: { some: { tagId: filtro.tagId } } })
    }
    if (filtro.originId) {
        and.push({ originId: filtro.originId })
    }
    if (filtro.dealStatus) {
        and.push({ deals: { some: { status: filtro.dealStatus } } })
    }
    if (filtro.search && filtro.search.trim()) {
        const s = filtro.search.trim()
        and.push({
            OR: [
                { name: { contains: s, mode: 'insensitive' } },
                { phone: { contains: s } },
            ],
        })
    }

    return { AND: and }
}

/** Quantos contatos o filtro alcança — para a prévia da tela antes de criar. */
export async function contarDoFiltro(workspaceId: string, filtro: FiltroDeLista): Promise<number> {
    return prisma.contact.count({ where: whereDoFiltro(workspaceId, filtro) })
}

/**
 * Popula (ou repovoa) os membros de uma lista a partir de um filtro.
 *
 * Congela os membros no momento — lista estática. Substitui os membros
 * anteriores, para repovoar ser idempotente. Devolve quantos entraram.
 */
export async function popularListaPorFiltro(
    workspaceId: string,
    listId: string,
    filtro: FiltroDeLista
): Promise<{ total: number }> {
    const contatos = await prisma.contact.findMany({
        where: whereDoFiltro(workspaceId, filtro),
        select: { id: true },
    })

    await prisma.$transaction([
        prisma.contactListMember.deleteMany({ where: { listId } }),
        prisma.contactListMember.createMany({
            data: contatos.map((c) => ({ listId, contactId: c.id })),
            skipDuplicates: true,
        }),
        prisma.contactList.update({
            where: { id: listId },
            data: { filter: filtro as unknown as Prisma.InputJsonValue },
        }),
    ])

    return { total: contatos.length }
}

/** Adiciona contatos escolhidos à mão a uma lista (seleção manual). */
export async function adicionarMembros(listId: string, contactIds: string[]): Promise<number> {
    const res = await prisma.contactListMember.createMany({
        data: contactIds.map((contactId) => ({ listId, contactId })),
        skipDuplicates: true,
    })
    return res.count
}
