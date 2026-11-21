import 'server-only'

import prisma from '@venn/db/cliente'
import type { Prisma } from '@venn/db'

import { dealScope, type WorkspaceMember } from '../auth/workspace'
import { fusoDaUnidade } from '../fuso-da-unidade'
import { fimDoDia, inicioDoDia } from '../fuso'
import {
    metricasDeEtapas,
    metricasDePerdas,
    metricasDeProdutos,
    metricasDePropostas,
    somarPorMoeda,
    type ItemParaMetrica,
    type PassagemParaMetrica,
    type PropostaParaMetrica,
} from './metricas'

/**
 * As consultas dos relatórios. As **contas** estão em `./metricas.ts`.
 *
 * A separação é a mesma de `lib/propostas/`: o que decide é puro e testável, o
 * que fala com o Postgres é casca. Aqui a casca também carrega duas obrigações
 * que nenhuma conta pode consertar depois — o recorte de visibilidade e o fuso.
 *
 * ## O recorte vem de `dealScope`, sempre
 *
 * Relatório é a superfície mais fácil de vazar dado entre pessoas: a tela não
 * mostra uma lista de registros, mostra um número — e um número que inclui o
 * negócio de outro vendedor não parece errado. Então o `where` sai de
 * `dealScope(membro)`, o mesmo de Negócios e de Propostas, e `resolveOwnerScope`
 * garante que o atendente receba o próprio recorte mesmo pedindo `?userId=all`.
 *
 * ## O período é o da UNIDADE, não o do servidor
 *
 * `inicioDoDia`/`fimDoDia` no fuso da unidade. Um relatório "de hoje" recortado
 * em UTC começa às 21h do dia anterior em Brasília, e a diferença aparece como
 * um negócio que some do dia em que foi fechado.
 *
 * ## Por que não há `COUNT(*)` aqui
 *
 * O contrato do estudo é explícito: *"`COUNT(*)` numa tabela multi-tenant
 * grande é caro; quem precisa pede"*. Estes relatórios buscam as linhas que vão
 * compor as contas e as contam em memória — o volume é o de um período, não o
 * da tabela. Onde isso deixar de valer, a saída é materializar, não contar.
 */

export interface EscopoDoRelatorio {
    de: string
    ate: string
    /** `null` ou `'all'` = todo mundo que o membro pode ver. */
    userId?: string | null
}

export interface JanelaResolvida {
    de: Date
    ate: Date
    fuso: string
}

export async function resolverJanela(
    workspaceId: string,
    escopo: EscopoDoRelatorio
): Promise<JanelaResolvida> {
    const fuso = await fusoDaUnidade(workspaceId)
    return { de: inicioDoDia(escopo.de, fuso), ate: fimDoDia(escopo.ate, fuso), fuso }
}

/** O recorte de dono, já com o atendente travado no próprio. */
function recorteDeDono(
    membro: Pick<WorkspaceMember, 'role' | 'userId' | 'departmentIds'>,
    pedido: string | null | undefined
): Prisma.DealWhereInput {
    const base = dealScope(membro)
    if (!pedido || pedido === 'all') return base
    /**
     * Pedir uma pessoa específica **estreita**, nunca alarga: o `AND` com
     * `dealScope` é o que impede um atendente de pedir `?userId=<outro>` e
     * receber o recorte de outra pessoa.
     */
    return { AND: [base, { userId: pedido }] }
}

// ──────────────────────────── propostas ────────────────────────────

export async function relatorioDePropostas(
    membro: Pick<WorkspaceMember, 'role' | 'userId' | 'departmentIds' | 'workspaceId'>,
    escopo: EscopoDoRelatorio
) {
    const janela = await resolverJanela(membro.workspaceId, escopo)

    const linhas = await prisma.proposal.findMany({
        where: {
            workspaceId: membro.workspaceId,
            deletedAt: null,
            createdAt: { gte: janela.de, lte: janela.ate },
            deal: recorteDeDono(membro, escopo.userId),
        },
        select: {
            id: true,
            kind: true,
            currency: true,
            /** Quantas versões a proposta teve — para "revisões até o aceite". */
            _count: { select: { revisions: true } },
            currentRevision: {
                select: {
                    status: true,
                    total: true,
                    shares: {
                        select: {
                            sharedAt: true,
                            acceptedAt: true,
                            _count: { select: { views: true } },
                        },
                    },
                },
            },
        },
    })

    /**
     * O tipo viaja JUNTO da métrica, num campo a mais.
     *
     * A primeira versão filtrava com `paraMetrica.filter((_, i) => linhas[i].kind === tipo)`
     * — correto enquanto os dois arrays estiverem na mesma ordem, e silenciosamente
     * errado no dia em que um `map` virar `flatMap` ou um filtro entrar no meio.
     * O índice paralelo é um acoplamento que não se vê.
     */
    const paraMetrica: (PropostaParaMetrica & { tipo: string })[] = linhas.map((p) => {
        const links = p.currentRevision?.shares ?? []
        /**
         * O envio é o PRIMEIRO compartilhamento, não o último.
         *
         * "Quantos dias o cliente levou" conta do momento em que ele recebeu o
         * documento. Um reenvio — porque o vendedor errou o destinatário, ou
         * porque cobrou resposta — zeraria o contador e faria o tempo até o
         * aceite parecer sempre curto.
         */
        const primeiroEnvio = links.reduce<Date | null>(
            (menor, l) => (menor === null || l.sharedAt < menor ? l.sharedAt : menor),
            null
        )
        const aceite = links.reduce<Date | null>(
            (achado, l) => achado ?? l.acceptedAt,
            null
        )
        // Aberturas somam TODOS os links da revisão: o cliente pode ter aberto
        // pelo primeiro link e pelo reenviado, e as duas vezes são ele lendo.
        const aberturas = links.reduce((s, l) => s + l._count.views, 0)

        return {
            tipo: p.kind,
            moeda: p.currency,
            valor: Number(p.currentRevision?.total ?? 0),
            estado: p.currentRevision?.status ?? 'rascunho',
            versoes: p._count.revisions,
            enviadaEm: primeiroEnvio,
            aceitaEm: aceite,
            aberturas,
        }
    })

    return {
        janela: { de: janela.de.toISOString(), ate: janela.ate.toISOString() },
        metricas: metricasDePropostas(paraMetrica),
        /** Quebra por tipo, porque contrato e orçamento têm ciclos diferentes. */
        porTipo: ['proposta', 'orcamento', 'contrato'].map((tipo) => ({
            tipo,
            metricas: metricasDePropostas(paraMetrica.filter((p) => p.tipo === tipo)),
        })),
    }
}

// ──────────────────────────── produtos ────────────────────────────

export async function relatorioDeProdutos(
    membro: Pick<WorkspaceMember, 'role' | 'userId' | 'departmentIds' | 'workspaceId'>,
    escopo: EscopoDoRelatorio
) {
    const janela = await resolverJanela(membro.workspaceId, escopo)

    /**
     * Os itens das revisões VIGENTES, não de todas.
     *
     * Uma proposta com três versões tem os itens das três no banco. Contar
     * todas faria o item que foi retirado na v2 continuar pesando no relatório —
     * e o que foi mantido pesar três vezes. O que vale é a versão que vale.
     */
    const itens = await prisma.proposalItem.findMany({
        where: {
            revision: {
                currentFor: {
                    workspaceId: membro.workspaceId,
                    deletedAt: null,
                    createdAt: { gte: janela.de, lte: janela.ate },
                    deal: recorteDeDono(membro, escopo.userId),
                },
            },
        },
        select: {
            productServiceId: true,
            description: true,
            quantity: true,
            total: true,
            revision: {
                select: {
                    status: true,
                    currentFor: { select: { currency: true } },
                },
            },
            productService: { select: { name: true, isActive: true, group: true } },
        },
    })

    const paraMetrica: ItemParaMetrica[] = itens.map((i) => ({
        productServiceId: i.productServiceId,
        // A descrição CONGELADA, não o nome atual do catálogo: é o que o
        // cliente leu, e é o que explica o número.
        descricao: i.description,
        quantidade: Number(i.quantity),
        total: Number(i.total),
        moeda: i.revision.currentFor?.currency ?? 'BRL',
        estadoDaRevisao: i.revision.status,
    }))

    const linhas = metricasDeProdutos(paraMetrica)

    /**
     * O grupo e o "ainda está no catálogo?" vêm por um de-para em memória.
     *
     * `groupBy` do Prisma não traz relação, e o relatório precisa saber se o
     * item que vendeu bem foi desativado — é a informação mais acionável da
     * tela: "isto vendeu 40 mil e saiu do catálogo".
     */
    const extras = new Map(
        itens
            .filter((i) => i.productServiceId)
            .map((i) => [
                i.productServiceId!,
                { grupo: i.productService?.group ?? null, ativo: i.productService?.isActive ?? false },
            ])
    )

    return {
        janela: { de: janela.de.toISOString(), ate: janela.ate.toISOString() },
        linhas: linhas.map((l) => ({
            ...l,
            grupo: l.productServiceId ? (extras.get(l.productServiceId)?.grupo ?? null) : null,
            // `null` para linha escrita à mão: ela nunca esteve no catálogo, e
            // dizer "inativo" sugeriria que esteve.
            ativoNoCatalogo: l.productServiceId ? (extras.get(l.productServiceId)?.ativo ?? null) : null,
        })),
    }
}

// ──────────────────────────── funil ────────────────────────────

export async function relatorioDeFunil(
    membro: Pick<WorkspaceMember, 'role' | 'userId' | 'departmentIds' | 'workspaceId'>,
    escopo: EscopoDoRelatorio & { pipelineId?: string | null }
) {
    const janela = await resolverJanela(membro.workspaceId, escopo)
    const recorte = recorteDeDono(membro, escopo.userId)

    const [passagens, perdidos, ganhos] = await Promise.all([
        /**
         * As passagens dos negócios **criados no período**, e todas elas.
         *
         * Recortar as passagens pela data delas quebraria a conta: o tempo numa
         * etapa precisa da passagem seguinte, e se ela caiu fora da janela a
         * etapa apareceria sem tempo. Então o recorte é pelo negócio, e as
         * passagens vêm inteiras.
         */
        prisma.dealStageEntry.findMany({
            where: {
                deal: {
                    workspaceId: membro.workspaceId,
                    createdAt: { gte: janela.de, lte: janela.ate },
                    ...(escopo.pipelineId ? { stage: { pipelineId: escopo.pipelineId } } : {}),
                    ...recorte,
                },
            },
            select: {
                dealId: true,
                stageId: true,
                enteredAt: true,
                createdAt: true,
                stage: { select: { name: true, order: true } },
            },
        }),
        prisma.deal.findMany({
            where: {
                workspaceId: membro.workspaceId,
                status: 'lost',
                // Fechado no período, não criado: "onde vaza" é sobre o
                // desfecho, e um negócio de três meses atrás que se perdeu
                // ontem é perda deste mês.
                closedAt: { gte: janela.de, lte: janela.ate },
                ...recorte,
            },
            select: {
                closedStageId: true,
                currency: true,
                value: true,
                closedValue: true,
                closedStage: { select: { name: true } },
                outcomeReason: { select: { name: true } },
            },
        }),
        prisma.deal.findMany({
            where: {
                workspaceId: membro.workspaceId,
                status: 'won',
                closedAt: { gte: janela.de, lte: janela.ate },
                ...recorte,
            },
            select: { currency: true, value: true, closedValue: true },
        }),
    ])

    const paraEtapas: PassagemParaMetrica[] = passagens.map((p) => ({
        dealId: p.dealId,
        stageId: p.stageId,
        stageName: p.stage.name,
        stageOrder: p.stage.order,
        // `enteredAt` é nulo em linha antiga; `createdAt` é a aproximação mais
        // próxima e existe sempre.
        entrouEm: p.enteredAt ?? p.createdAt,
    }))

    /** O que de fato fechou, quando houve — `closedValue` antes de `value`. */
    const valorFechado = (d: { value: number | null; closedValue: number | null }) =>
        d.closedValue ?? d.value ?? 0

    return {
        janela: { de: janela.de.toISOString(), ate: janela.ate.toISOString() },
        etapas: metricasDeEtapas(paraEtapas),
        perdas: metricasDePerdas(
            perdidos.map((d) => ({
                closedStageId: d.closedStageId,
                closedStageName: d.closedStage?.name ?? null,
                motivo: d.outcomeReason?.name ?? null,
                moeda: d.currency,
                valor: valorFechado(d),
            }))
        ),
        ganhos: {
            quantos: ganhos.length,
            valor: somarPorMoeda(ganhos.map((d) => ({ moeda: d.currency, valor: valorFechado(d) }))),
        },
    }
}
