import type { Prisma } from '@prisma/client'

/**
 * O período, aplicado ao campo que a pergunta pede.
 *
 * Negócio aberto se corta por **criação** — "quantos entraram no período" — e
 * negócio finalizado por **fechamento**: perguntar "quanto ganhei em outubro" e
 * receber o que foi *criado* em outubro responde outra coisa, porque o ganho de
 * outubro pode ter nascido em agosto.
 *
 * Existe num módulo só porque três rotas precisam da mesma regra — o quadro, a
 * lista e o resumo. Quando o filtro de data valia só para o resumo, a tela
 * mostrava três números de um recorte e uma lista de outro.
 */
export function periodWhere(
    status: string,
    dateFrom?: string | null,
    dateTo?: string | null
): Prisma.DealWhereInput {
    if (!dateFrom && !dateTo) return {}

    const range: { gte?: Date; lte?: Date } = {}
    if (dateFrom) range.gte = new Date(dateFrom)
    if (dateTo) range.lte = new Date(`${dateTo}T23:59:59.999Z`)

    const closedView = status === 'won' || status === 'lost' || status === 'closed'
    return closedView ? { closedAt: range } : { createdAt: range }
}
