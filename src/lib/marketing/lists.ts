import 'server-only'
import { Prisma } from '#prisma'
import prisma from '@/lib/prisma'
import { contatosEntraramNaLista } from '@/lib/funil/disparos'
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

    /**
     * Quem **entrou agora**, medido antes de reescrever.
     *
     * A sincronização é `deleteMany` + `createMany`: ela refaz o conjunto
     * inteiro. Sem este diff, o gatilho de funil "entrou na lista" dispararia
     * para todos os membros a cada sincronização, e o paciente receberia a
     * sequência de novo a cada vez que alguém salvasse o filtro.
     *
     * Com o diff, a sincronização seguinte só liga o funil para quem cruzou o
     * critério de verdade — paciente que acabou de completar seis meses sem
     * retorno, que é exatamente o caso de uso.
     */
    const antes = await prisma.contactListMember.findMany({
        where: { listId },
        select: { contactId: true },
    })
    const jaEstavam = new Set(antes.map((m) => m.contactId))
    const novos = contatos.map((c) => c.id).filter((id) => !jaEstavam.has(id))

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

    /**
     * A **primeira** sincronização de uma lista sobre uma base existente é
     * indistinguível de um blast: todo mundo é "novo".
     *
     * A rédea não é um número escolhido aqui — é o teto de ativos do funil, que
     * a clínica define e que a publicação **exige** quando o gatilho é de lista
     * (ver `podePublicar` em `lib/funil/publicar.ts`). Quem não quer teto não
     * usa gatilho de lista.
     */
    if (novos.length > 0) {
        await contatosEntraramNaLista(workspaceId, listId, novos)
    }

    return { total: contatos.length }
}

/**
 * **Acrescenta** quem casa com um filtro, sem tirar ninguém.
 *
 * ## Por que não é `popularListaPorFiltro`
 *
 * Aquela função **substitui** o conjunto: `deleteMany` + `createMany`. É o certo
 * para repovoar uma lista a partir do critério dela, e é exatamente o errado
 * para "acrescente também os de ortodontia" — tiraria todos os outros, em
 * silêncio, e o único sinal seria a contagem caindo numa tela que a pessoa
 * talvez nem esteja olhando.
 *
 * ## O canal vem da lista, não de quem chama
 *
 * Quem acrescenta escolhe etiqueta, origem, estado do negócio. **Não** escolhe
 * o canal: ele é da lista, e deixá-lo passar no filtro permitiria entrar numa
 * lista de e-mail alguém sem endereço — que é a única coisa que uma lista de
 * e-mail não pode ter, porque faria a contagem da tela mentir sobre o alcance.
 */
export async function acrescentarPorFiltro(
    workspaceId: string,
    listId: string,
    canal: CanalDeCampanha,
    filtro: FiltroDeLista
): Promise<number> {
    const candidatos = await prisma.contact.findMany({
        where: whereDoFiltro(workspaceId, { ...filtro, canal }),
        select: { id: true },
    })
    if (candidatos.length === 0) return 0

    return adicionarMembros(
        listId,
        candidatos.map((c) => c.id),
        workspaceId
    )
}

/**
 * Quantos **entrariam** — os que casam e ainda não estão dentro.
 *
 * `contarDoFiltro` conta quem casa, e serve para a criação, onde a lista está
 * vazia. Aqui os dois números divergem: "428 contatos têm esta etiqueta" e "12
 * entrariam" respondem perguntas diferentes, e mostrar o primeiro no botão de
 * acrescentar faria a pessoa esperar 428 entradas novas.
 */
export async function contarParaAcrescentar(
    workspaceId: string,
    listId: string,
    canal: CanalDeCampanha,
    filtro: FiltroDeLista
): Promise<number> {
    return prisma.contact.count({
        where: {
            AND: [
                whereDoFiltro(workspaceId, { ...filtro, canal }),
                { listMemberships: { none: { listId } } },
            ],
        },
    })
}

/**
 * Tira contatos de uma lista.
 *
 * Só o vínculo sai — o contato não é tocado. E **não** mexe em opt-out: sair de
 * uma lista não é pedir para não receber nada, é não estar nesta lista. Quem
 * confundir os dois tira do cliente a possibilidade de voltar.
 */
export async function removerMembros(listId: string, contactIds: string[]): Promise<number> {
    if (contactIds.length === 0) return 0
    const { count } = await prisma.contactListMember.deleteMany({
        where: { listId, contactId: { in: contactIds } },
    })
    return count
}

/**
 * Quem, nesta lista, **não serve** ao canal — por falta de endereço ou por
 * opt-out naquele canal.
 *
 * Existe por causa da troca de canal numa lista que já tem gente: uma lista de
 * WhatsApp virando lista de e-mail leva consigo todo mundo que não tem endereço,
 * e esses contatos seriam congelados como destinatários e descartados no
 * disparo — a contagem da tela prometendo um alcance que o relatório desmentiria.
 *
 * Devolve quem sobra para quem chama decidir: a tela mostra o número **antes**
 * de salvar, e a rota remove ao salvar. Nenhuma remoção acontece sem a pessoa
 * ter visto quantos são.
 */
export async function membrosForaDoCanal(
    workspaceId: string,
    listId: string,
    canal: CanalDeCampanha
): Promise<string[]> {
    const dentro = await prisma.contactListMember.findMany({
        where: { listId },
        select: { contactId: true },
    })
    if (dentro.length === 0) return []

    const ids = dentro.map((m) => m.contactId)
    const servem = await prisma.contact.findMany({
        where: { AND: [{ id: { in: ids } }, whereDoFiltro(workspaceId, { canal })] },
        select: { id: true },
    })

    const ok = new Set(servem.map((c) => c.id))
    return ids.filter((id) => !ok.has(id))
}

/** Adiciona contatos escolhidos à mão a uma lista (seleção manual). */
export async function adicionarMembros(
    listId: string,
    contactIds: string[],
    /**
     * O workspace, para o gatilho de funil.
     *
     * Opcional porque esta função já existia sem ele; sem o workspace o vínculo
     * é criado e **o funil não dispara**, o que é melhor que adivinhar a
     * unidade a partir do `listId` numa função que nunca precisou disso.
     */
    workspaceId?: string
): Promise<number> {
    const antes = await prisma.contactListMember.findMany({
        where: { listId, contactId: { in: contactIds } },
        select: { contactId: true },
    })
    const jaEstavam = new Set(antes.map((m) => m.contactId))

    const res = await prisma.contactListMember.createMany({
        data: contactIds.map((contactId) => ({ listId, contactId })),
        skipDuplicates: true,
    })

    if (workspaceId) {
        const novos = contactIds.filter((id) => !jaEstavam.has(id))
        if (novos.length > 0) await contatosEntraramNaLista(workspaceId, listId, novos)
    }

    return res.count
}

/**
 * Quem é destinatário elegível de uma campanha, por canal.
 *
 * ## Por que isto é uma função e não dois `where` parecidos
 *
 * Dois lugares precisam da mesma resposta: a rota de disparo, que **estima** o
 * alcance para conferir o teto do plano, e `congelarDestinatarios`, que
 * **grava** os destinatários. Escritos separados, eles divergem — e o sintoma é
 * cruel: a tela confere o plano contra 2.000, o disparo grava 700, e ninguém
 * descobre até alguém comparar o relatório com a expectativa.
 *
 * Os dois eixos que o canal move são o endereço (telefone × e-mail) e a coluna
 * de opt-out, que são separadas de propósito — ver `whereDoFiltro`.
 */
export function whereDeDestinatarios(
    workspaceId: string,
    canal: CanalDeCampanha,
    listIds: string[]
): Prisma.ContactWhereInput {
    const porEmail = canal === 'email'
    return {
        workspaceId,
        ...(porEmail
            ? { email: { not: null }, emailOptOutAt: null }
            : { phone: { not: null }, autoMessagesPausedAt: null }),
        listMemberships: { some: { listId: { in: listIds } } },
    }
}
