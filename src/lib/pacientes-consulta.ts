import { Prisma } from '#prisma'

import { contactScope, type WorkspaceMember } from '@/lib/auth/workspace'
import { LIMITE_PADRAO, type PaginaDeIndice } from '@/lib/indice'
import prisma from '@/lib/prisma'
import { searchTerms } from '@/lib/search'

/**
 * A consulta da lista de pacientes — **uma só**, usada pela rota e pela casca
 * de servidor da tela.
 *
 * Nas outras telas de índice eu repliquei a consulta no `page.tsx`, e ali isso
 * é aceitável: são `where` de uma linha com um `orderBy`. Aqui não seria. Esta
 * consulta tem o recorte de quem vê o quê (`contactScope` — atendente só vê o
 * que é dele), busca por termos normalizados, filtro de etiqueta que alcança
 * **as etiquetas da conversa também**, filtro de origem, intervalo de data,
 * estado de negócio, ordenação variável e uma **fusão de etiquetas com
 * deduplicação** no fim. Duas cópias disso divergem na primeira manutenção — e
 * divergir aqui significa a primeira pintura mostrar uma lista e a releitura
 * mostrar outra, que é exatamente o defeito que a refatoração veio matar.
 *
 * Então a regra desta tela é mais forte que a das outras: **a rota e a casca
 * chamam a mesma função.** Se ela mudar, muda para as duas.
 */

/** Uma etiqueta como a lista a mostra. */
export interface EtiquetaDoPaciente {
    id: string
    name: string
    color: string
}

/** Valor de um campo personalizado — o conjunto fechado que o editor oferece. */
export type ValorDeCampo = string | number | boolean | null

/**
 * O paciente como a lista o consome.
 *
 * Declara **os campos que a tela usa**, e não uma assinatura de índice: com
 * `[k: string]: unknown` todo campo não listado chegaria como `unknown` e o
 * `customFields` quebraria no primeiro uso. Em tempo de execução o objeto
 * continua trazendo os demais escalares do contato — a rota segue devolvendo o
 * `...resto` inteiro, e nada no contrato dela muda.
 */
export interface PacienteDaLista {
    id: string
    name: string | null
    email: string | null
    phone: string | null
    notes: string | null
    createdVia: string | null
    customFields: Record<string, ValorDeCampo> | null
    /** ISO. Convertido aqui para o campo não ter dois tipos ao longo da vida da
     *  tela: a rota entrega string (o JSON serializa a `Date`) e o RSC
     *  entregaria `Date`. O JSON da rota não muda — é o mesmo ISO. */
    createdAt: string
    /** A origem comercial da ficha. Ver o comentário do `include`. */
    origin: { id: string; name: string } | null
    tags: { tag: EtiquetaDoPaciente }[]
}

export interface FiltrosDePaciente {
    search?: string
    page?: number
    limit?: number
    tagId?: string | null
    originId?: string | null
    dateFrom?: string | null
    dateTo?: string | null
    dealStatus?: string | null
    sortBy?: string
    sortDir?: 'asc' | 'desc'
}

/**
 * O recorte que a tela serve na montagem — e que o `recorte` do hook precisa
 * descrever para a primeira pintura não disparar busca.
 */
export const FILTROS_PADRAO = {
    search: '',
    page: 1,
    limit: LIMITE_PADRAO,
    sortBy: 'createdAt',
    sortDir: 'desc' as const,
}

export async function consultarPacientes(
    membro: WorkspaceMember,
    filtros: FiltrosDePaciente = {}
): Promise<PaginaDeIndice<PacienteDaLista>> {
    const {
        search = FILTROS_PADRAO.search,
        page = FILTROS_PADRAO.page,
        limit = FILTROS_PADRAO.limit,
        tagId = null,
        originId = null,
        dateFrom = null,
        dateTo = null,
        dealStatus = null,
        sortBy = FILTROS_PADRAO.sortBy,
        sortDir = FILTROS_PADRAO.sortDir,
    } = filtros

    const where: Prisma.ContactWhereInput = { workspaceId: membro.workspaceId }

    if (search) {
        // `searchText` é gerada pelo banco com nome, e-mail e telefone já sem
        // acento e em minúsculas — uma comparação resolve o que antes eram três.
        where.OR = searchTerms(search).map((term) => ({ searchText: { contains: term } }))
    }

    /**
     * O que vale **junto**: o recorte de quem vê o quê e, havendo, a etiqueta.
     * `AND` e não `OR`, para a etiqueta restringir a busca em vez de alargá-la;
     * e em lista, porque os dois usam este campo e o segundo apagaria o primeiro.
     */
    const todas: Prisma.ContactWhereInput[] = [contactScope(membro)]
    if (tagId) {
        todas.push({
            OR: [
                { tags: { some: { tagId } } },
                { conversations: { some: { tags: { some: { tagId } } } } },
            ],
        })
    }
    where.AND = todas

    // A origem comercial é da ficha. O canal por onde o paciente escreveu é da
    // conversa, e não se filtra aqui.
    if (originId) where.originId = originId

    if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = new Date(dateFrom)
        if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59.999Z')
    }

    if (dealStatus === 'none') where.deals = { none: {} }
    else if (dealStatus === 'open' || dealStatus === 'won' || dealStatus === 'lost') {
        where.deals = { some: { status: dealStatus } }
    }

    const orderBy: Prisma.ContactOrderByWithRelationInput = {}
    if (sortBy === 'name') orderBy.name = sortDir
    else if (sortBy === 'email') orderBy.email = sortDir
    else if (sortBy === 'phone') orderBy.phone = sortDir
    else orderBy.createdAt = sortDir

    const [contatos, total] = await Promise.all([
        prisma.contact.findMany({
            where,
            include: {
                /**
                 * **A origem faltava, e a coluna "Origem" nunca mostrou nada.**
                 *
                 * A tela desenha `c.origin ? <StatusBadge …/> : '—'` e exporta
                 * `c.origin?.name` no CSV, mas o `include` não trazia a
                 * relação: `origin` chegava `undefined` e a coluna caía no
                 * traço para todo paciente, inclusive os que têm origem
                 * gravada. O tipo do cliente declarava o campo como
                 * obrigatório, então nem o compilador reclamava.
                 *
                 * Achado ao extrair esta consulta, em 2026-10-26. A correção é
                 * aditiva: a resposta da rota ganha um campo, ninguém perde.
                 */
                origin: { select: { id: true, name: true } },
                tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
                conversations: {
                    select: {
                        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
                    },
                },
            },
            orderBy,
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.contact.count({ where }),
    ])

    /**
     * Etiqueta é do paciente, e a conversa mostra a união das duas pontas
     * (ver DESIGN.md, "Etiqueta é do paciente"). Por isso a lista funde as da
     * ficha com as das conversas, deduplicando pelo id — um `Map` basta.
     */
    const itens = contatos.map((contato) => {
        const porId = new Map<string, EtiquetaDoPaciente>()
        for (const ct of contato.tags) porId.set(ct.tag.id, ct.tag)
        for (const conversa of contato.conversations) {
            for (const ct of conversa.tags) porId.set(ct.tag.id, ct.tag)
        }

        // Tira as três chaves por `delete` em vez de desestruturar para
        // variáveis que ninguém lê: o descarte por desestruturação deixa
        // variáveis não usadas, e silenciá-las com `_` esconderia um aviso que
        // vale a pena manter ligado no resto do arquivo.
        const resto: Record<string, unknown> = { ...contato }
        delete resto.conversations
        delete resto.tags
        delete resto.createdAt

        return {
            ...resto,
            createdAt: contato.createdAt.toISOString(),
            tags: Array.from(porId.values()).map((tag) => ({ tag })),
        } as PacienteDaLista
    })

    return { itens, total, totalPages: Math.ceil(total / limit) }
}
