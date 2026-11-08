import 'server-only'
import { Prisma } from '#prisma'
import prisma from '@/lib/prisma'
import type { CanalDeCampanha } from '@/lib/marketing/apresentacao'

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
    /**
     * Por qual canal esta lista serve. Padrão `whatsapp` — era o único canal
     * quando o módulo nasceu, e manter o padrão preserva as listas já criadas.
     *
     * **Muda quem entra na lista**, não só o rótulo: ver `whereDoFiltro`.
     */
    canal?: CanalDeCampanha
}

/**
 * Monta o `where` a partir do filtro, sempre preso ao workspace.
 *
 * ## Os dois eixos que o canal move
 *
 * **Endereço.** Contato sem telefone não recebe WhatsApp, e contato sem e-mail
 * não recebe e-mail. O recorte acontece aqui, na origem da lista, e não no
 * disparo: deixar passar faria a contagem da tela mentir sobre o alcance — a
 * clínica veria "2.000 contatos" numa lista de e-mail onde 1.300 não têm
 * endereço, e descobriria no relatório da campanha.
 *
 * **Opt-out.** São colunas separadas de propósito: quem se descadastrou da
 * newsletter não pediu que o atendimento por WhatsApp parasse, e quem respondeu
 * "pare" no WhatsApp não pediu para sair da newsletter. Consultar a coluna
 * errada calaria o canal onde a clínica de fato atende.
 */
function whereDoFiltro(workspaceId: string, filtro: FiltroDeLista): Prisma.ContactWhereInput {
    const and: Prisma.ContactWhereInput[] = [{ workspaceId }]

    const porEmail = filtro.canal === 'email'

    and.push(porEmail ? { email: { not: null } } : { phone: { not: null } })

    if (filtro.excluirOptOut !== false) {
        and.push(porEmail ? { emailOptOutAt: null } : { autoMessagesPausedAt: null })
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
                // O segundo termo acompanha o canal: buscar por telefone numa
                // lista de e-mail nao acha quem a pessoa esta procurando.
                porEmail
                    ? { email: { contains: s, mode: 'insensitive' } }
                    : { phone: { contains: s } },
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
