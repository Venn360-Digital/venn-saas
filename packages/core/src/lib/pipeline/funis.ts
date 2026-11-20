import 'server-only'

import prisma from '@venn/db/cliente'
import type { Prisma } from '@venn/db'

import { DEFAULT_PIPELINE_STAGES } from '../palette'

/**
 * Os funis de venda de uma unidade — e qual deles é o do atendimento.
 *
 * ## Por que um módulo, e não uma consulta em cada lugar
 *
 * Até 20/11/2026 o funil era implícito ("as fases da unidade"), e dez lugares
 * do código perguntavam `pipelineStage.findMany({ where: { workspaceId } })`
 * cada um por si. Com mais de um funil, cada um desses lugares precisa saber
 * **qual**: o negócio que nasce da mensagem entra no padrão, o cartão da caixa
 * de entrada lê o padrão, o agente só move no padrão, o painel da conversa
 * mostra a jornada do padrão. Se cada lugar decidisse sozinho o que é "o
 * padrão", eles divergiriam no primeiro caso de borda — a unidade que ainda não
 * marcou nenhum, a fase órfã da janela do deploy. Aqui a resposta é uma.
 *
 * ## O padrão nunca é `null` para quem tem fase
 *
 * `funilPadrao()` devolve `null` só para a unidade que não tem fase nenhuma —
 * o mesmo estado em que o código já não criava negócio. Em todos os outros
 * casos ela encontra ou **conserta**: sem nenhum marcado, marca o mais antigo;
 * com fase órfã (sem `pipelineId`, pela janela do deploy ou por código velho),
 * adota no padrão. É o que deixa a coluna ficar opcional no schema sem o
 * produto ter de tratar nulo em dez lugares.
 */

export interface FunilDeVendas {
    id: string
    name: string
    isDefault: boolean
}

/** O nome com que o funil de uma unidade nasce, quando ninguém o batiza. */
export const NOME_DO_FUNIL_PADRAO = 'Funil de vendas'

/**
 * O funil do atendimento desta unidade, ou `null` se ela não tem fase nenhuma.
 *
 * Três passos, e os dois últimos são conserto:
 *
 * 1. o marcado como padrão;
 * 2. senão, o mais antigo — e ele passa a ser marcado, para a próxima leitura
 *    não refazer a escolha;
 * 3. se a unidade tem fase mas nenhum funil (fase criada por código velho na
 *    janela do deploy, antes de o seed e o onboarding criarem o funil junto),
 *    cria o padrão e adota as fases.
 *
 * E em qualquer caso adota a fase órfã — `pipelineId` nulo — no padrão.
 */
export async function funilPadrao(workspaceId: string): Promise<FunilDeVendas | null> {
    let funil = await prisma.pipeline.findFirst({
        where: { workspaceId, isDefault: true },
        select: { id: true, name: true, isDefault: true },
    })

    if (!funil) {
        const maisAntigo = await prisma.pipeline.findFirst({
            where: { workspaceId },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, name: true, isDefault: true },
        })
        if (maisAntigo) {
            await prisma.pipeline.update({ where: { id: maisAntigo.id }, data: { isDefault: true } })
            funil = { ...maisAntigo, isDefault: true }
        }
    }

    if (!funil) {
        const temFase = await prisma.pipelineStage.findFirst({
            where: { workspaceId },
            select: { id: true },
        })
        if (!temFase) return null

        const criado = await prisma.pipeline.create({
            data: { workspaceId, name: NOME_DO_FUNIL_PADRAO, isDefault: true, order: 0 },
            select: { id: true, name: true, isDefault: true },
        })
        funil = criado
    }

    // A órfã da janela do deploy entra no padrão. Zero linhas na quase
    // totalidade das chamadas — a escrita só acontece quando há o que adotar.
    await prisma.pipelineStage.updateMany({
        where: { workspaceId, pipelineId: null },
        data: { pipelineId: funil.id },
    })

    return funil
}

/**
 * Um funil desta unidade, pelo id — ou o padrão quando o id não vem.
 *
 * É a resolução que toda rota de Negócios faz: `?funil=<id>` escolhe, ausência
 * cai no padrão. Id de outra unidade devolve `null`, não o padrão — aceitar id
 * alheio em silêncio seria responder "não existe" com as fases de outra
 * clínica.
 */
export async function funilOuPadrao(
    workspaceId: string,
    funilId: string | null | undefined
): Promise<FunilDeVendas | null> {
    if (!funilId) return funilPadrao(workspaceId)
    return prisma.pipeline.findFirst({
        where: { id: funilId, workspaceId },
        select: { id: true, name: true, isDefault: true },
    })
}

/** Os funis da unidade, na ordem do seletor, com o padrão sempre resolvido. */
export async function funisDaUnidade(workspaceId: string): Promise<FunilDeVendas[]> {
    // Resolve o padrão primeiro: é o que garante que a lista devolvida tem
    // exatamente um `isDefault`, mesmo para a unidade que nunca marcou.
    await funilPadrao(workspaceId)
    return prisma.pipeline.findMany({
        where: { workspaceId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, isDefault: true },
    })
}

/**
 * A primeira fase do funil padrão — onde o negócio que nasce da mensagem entra.
 *
 * `null` quando a unidade não tem fase, que é o estado em que o produto já não
 * criava negócio (ver `ensureOpenDeal`).
 */
export async function primeiraFaseDoPadrao(workspaceId: string): Promise<{ id: string; pipelineId: string } | null> {
    const funil = await funilPadrao(workspaceId)
    if (!funil) return null
    const fase = await prisma.pipelineStage.findFirst({
        where: { workspaceId, pipelineId: funil.id },
        orderBy: { order: 'asc' },
        select: { id: true },
    })
    return fase ? { id: fase.id, pipelineId: funil.id } : null
}

/**
 * O recorte "negócio deste funil", para compor em `where` de `Deal`.
 *
 * Um negócio pertence a um funil **pela fase em que está** — não há coluna
 * duplicada no negócio para divergir. O custo é um join com `pipeline_stages`,
 * que é uma tabela de dezenas de linhas por unidade.
 */
export function noFunil(pipelineId: string): Prisma.DealWhereInput {
    return { stage: { pipelineId } }
}

/**
 * O negócio aberto do contato **neste funil**, se houver.
 *
 * A regra 1:1 — um negócio aberto por contato — virou 1:1 **por funil** em
 * 20/11/2026: a mesma pessoa pode ter uma avaliação em andamento num funil e
 * um plano em negociação noutro. Dentro de um funil continua valendo um só,
 * porque é isso que faz o cartão da caixa de entrada e o agente saberem de
 * qual negócio estão falando.
 */
export async function negocioAbertoNoFunil(
    workspaceId: string,
    contactId: string,
    pipelineId: string,
    opcoes: { exceto?: string } = {}
): Promise<{ id: string } | null> {
    return prisma.deal.findFirst({
        where: {
            workspaceId,
            contactId,
            status: 'open',
            ...noFunil(pipelineId),
            ...(opcoes.exceto ? { id: { not: opcoes.exceto } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    })
}

/**
 * Semeia um funil com as fases padrão — para o seed, o onboarding e o funil
 * novo criado pela tela.
 *
 * Aceita a transação porque o onboarding roda tudo numa só; fora dela, passe
 * o `prisma` mesmo. `isDefault` é decidido por quem chama: o primeiro funil da
 * unidade é o padrão, o segundo não.
 */
export async function semearFunil(
    tx: Prisma.TransactionClient,
    entrada: { workspaceId: string; name: string; isDefault: boolean; order?: number }
): Promise<{ id: string }> {
    const funil = await tx.pipeline.create({
        data: {
            workspaceId: entrada.workspaceId,
            name: entrada.name,
            isDefault: entrada.isDefault,
            order: entrada.order ?? 0,
        },
        select: { id: true },
    })
    await tx.pipelineStage.createMany({
        data: DEFAULT_PIPELINE_STAGES.map((etapa) => ({
            ...etapa,
            workspaceId: entrada.workspaceId,
            pipelineId: funil.id,
        })),
    })
    return funil
}
