import prisma from '@/lib/prisma'
import { readAutomations } from '@/lib/automations'
import {
    destinoDaEntrega,
    escolherDono,
    type MembroElegivel,
    type StatusDoMembro,
} from '@/lib/conversas/distribuicao'
import { createLogger } from '@/trabalhos/registro'

const log = createLogger('DONO')

/**
 * A casca do dono da conversa: consulta, aplica a decisão, grava.
 *
 * **Casca fina de propósito.** Quem decide é `lib/conversas/distribuicao.ts`,
 * que é puro e provado em Node por `scripts/test-distribuicao.ts`. Aqui só mora
 * o que precisa de banco: quem são os elegíveis, quantas abertas cada um tem, e
 * a escrita. O workerd não roda nesta máquina — misturar as duas coisas tornaria
 * a parte que importa impossível de testar.
 *
 * Ver §11 de `docs/agente-ia/estudo-metodo-de-treinamento.md`.
 */

/**
 * Os elegíveis de uma linha, já com o que o rodízio e o balanceado precisam.
 *
 * **O departamento vem da linha, não da conversa** — é um fato do terreno, não
 * uma escolha: `AgentIntegration.departmentId` existe, `Conversation` não tem
 * departamento. Linha sem departamento (intake, widget, histórico antigo) abre
 * para todos os elegíveis do workspace, que é o que faz a fila geral existir.
 *
 * `recebeConversas` é marca por pessoa, e o papel só definiu o padrão na
 * migração. A regra "só ATENDENTE" quebraria a clínica de uma pessoa só.
 */
export async function elegiveisDaLinha(
    workspaceId: string,
    integrationId: string | null
): Promise<MembroElegivel[]> {
    /**
     * **O escopo passa pelo agente, e isto não é estilo.** `AgentIntegration`
     * não tem `workspaceId`: ela pertence a um `Agent`, que pertence à clínica.
     * Um `findFirst` só por `id` aceitaria a linha de outra clínica se o id
     * viesse errado — e aí o departamento de lá escolheria quem atende aqui.
     * Mesma regra de `lib/auth/workspace.ts` e de `resolverResponsavel`.
     */
    const departmentId = integrationId
        ? (
              await prisma.agentIntegration.findFirst({
                  where: { id: integrationId, agent: { workspaceId } },
                  select: { departmentId: true },
              })
          )?.departmentId ?? null
        : null

    const membros = await prisma.workspaceUser.findMany({
        where: {
            workspaceId,
            isActive: true,
            recebeConversas: true,
            ...(departmentId ? { departments: { some: { departmentId } } } : {}),
        },
        select: { userId: true, status: true },
    })
    if (membros.length === 0) return []

    const ids = membros.map((m) => m.userId)

    /**
     * Duas agregações em vez de N consultas: a última atribuição e a contagem
     * de abertas saem cada uma num `groupBy`. Isto roda na entrada de **toda**
     * conversa nova, então o custo importa.
     */
    const [ultimas, abertas] = await Promise.all([
        prisma.conversation.groupBy({
            by: ['ownerId'],
            where: { workspaceId, ownerId: { in: ids } },
            _max: { ownerAssignedAt: true },
        }),
        prisma.conversation.groupBy({
            by: ['ownerId'],
            where: { workspaceId, ownerId: { in: ids }, status: 'active' },
            _count: { _all: true },
        }),
    ])

    const porUltima = new Map(ultimas.map((u) => [u.ownerId, u._max.ownerAssignedAt]))
    const porAbertas = new Map(abertas.map((a) => [a.ownerId, a._count._all]))

    return membros.map((m) => ({
        userId: m.userId,
        status: m.status as StatusDoMembro,
        ultimaAtribuicao: porUltima.get(m.userId) ?? null,
        abertas: porAbertas.get(m.userId) ?? 0,
    }))
}

/** A política da clínica, com os padrões centralizados. */
async function politicaDo(workspaceId: string) {
    const w = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { automations: true },
    })
    return readAutomations(w?.automations).distribuicao
}

/**
 * Dá dono a uma conversa que ainda não tem. Devolve o `userId`, ou `null`.
 *
 * **Idempotente por desenho:** o `updateMany` exige `ownerId: null`, então duas
 * mensagens que cheguem no mesmo instante não trocam o dono uma da outra — a
 * segunda não encontra linha para atualizar e sai sem fazer nada.
 *
 * Nunca lança. O chamador é o caminho de entrada da mensagem, e uma conversa
 * sem dono é um estado previsto — não um erro que justifique derrubar o
 * atendimento.
 */
export async function darDono(entrada: {
    workspaceId: string
    conversationId: string
    integrationId: string | null
    origem?: 'rodizio' | 'balanceado' | 'recepcao'
}): Promise<string | null> {
    try {
        const politica = await politicaDo(entrada.workspaceId)
        if (politica.estrategia === 'nenhuma') return null

        const elegiveis = await elegiveisDaLinha(entrada.workspaceId, entrada.integrationId)
        const escolhido = escolherDono(elegiveis, politica)
        if (!escolhido) return null

        const r = await prisma.conversation.updateMany({
            where: { id: entrada.conversationId, workspaceId: entrada.workspaceId, ownerId: null },
            data: {
                ownerId: escolhido,
                ownerAssignedAt: new Date(),
                ownerSource: entrada.origem ?? politica.estrategia,
            },
        })
        if (r.count === 0) return null

        log.info(`conversa ${entrada.conversationId} → ${escolhido} (${politica.estrategia})`)
        return escolhido
    } catch (erro) {
        // Distribuir é melhoria, não requisito: falhar aqui não pode impedir a
        // mensagem de ser atendida.
        log.warn(`não deu para distribuir ${entrada.conversationId}: ${String(erro)}`)
        return null
    }
}

/**
 * Para quem vai a entrega — e aqui o status vale **sempre**.
 *
 * O dono serve a duas coisas: a carteira e saber quem entra quando a IA não dá
 * conta. A primeira tolera erro; a segunda não. Se o dono não está disponível,
 * a entrega vai para a fila geral, visível a todos.
 *
 * O caso concreto: paciente com dor às 19h, dono designado às 14h já em casa.
 */
export async function donoDisponivel(
    workspaceId: string,
    ownerId: string | null
): Promise<string | null> {
    if (!ownerId) return null

    const m = await prisma.workspaceUser.findFirst({
        where: { workspaceId, userId: ownerId, isActive: true },
        select: { userId: true, status: true },
    })
    if (!m) return null

    return destinoDaEntrega({
        userId: m.userId,
        status: m.status as StatusDoMembro,
        ultimaAtribuicao: null,
        abertas: 0,
    })
}
