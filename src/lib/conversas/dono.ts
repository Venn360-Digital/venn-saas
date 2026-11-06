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
        select: { userId: true, status: true, ultimaAtividadeEm: true },
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
        ultimaAtividadeEm: m.ultimaAtividadeEm,
    }))
}

/** A política da clínica, com os padrões centralizados. */
async function politicaDo(workspaceId: string) {
    const w = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { automations: true },
    })
    const a = readAutomations(w?.automations)
    return { ...a.distribuicao, minutosParaAusente: a.minutosParaAusente }
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
        const escolhido = escolherDono(elegiveis, politica, politica.minutosParaAusente)
        if (!escolhido) return null

        /**
         * Grava `assignedTo` — onde a tela procura o responsável.
         *
         * **Era `ownerId`, e tinha de ser**, porque `assignedTo` era o mutex do
         * agente: distribuir por ele calaria o bot no ato de distribuir. Com o
         * mutex movido para `atendidaPor` (ver `isHumanHandled`), a razão caiu.
         *
         * O defeito que isto conserta foi medido no primeiro lead que chegou
         * depois do deploy do portão: `ownerId` = Rachel, `assignedTo` nulo, e a
         * conversa invisível nas "Minhas" dela. É o que o Andre relatou como
         * "o lead entra, ganha um responsável e não aparece no filtro minhas".
         *
         * **`atendidaPor` não é tocado aqui, de propósito.** Distribuir diz de
         * quem a conversa é; não diz que alguém já a está atendendo. O lead
         * recém-chegado nasce `bot` e continua `bot` depois do rodízio — é
         * exatamente a combinação "Com a IA + com responsável" que a coluna
         * passou a saber mostrar.
         *
         * A guarda do `where` segue sendo `ownerId: null` enquanto a coluna
         * existe: é ela que torna a distribuição idempotente, e trocá-la por
         * `assignedTo: null` na mesma mudança faria duas coisas de uma vez. A
         * troca vem na fase de contract, junto da queda da coluna.
         */
        const r = await prisma.conversation.updateMany({
            where: { id: entrada.conversationId, workspaceId: entrada.workspaceId, ownerId: null },
            data: {
                assignedTo: escolhido,
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

    const [m, politica] = await Promise.all([
        prisma.workspaceUser.findFirst({
            where: { workspaceId, userId: ownerId, isActive: true },
            select: { userId: true, status: true, ultimaAtividadeEm: true },
        }),
        politicaDo(workspaceId),
    ])
    if (!m) return null

    return destinoDaEntrega(
        {
            userId: m.userId,
            status: m.status as StatusDoMembro,
            ultimaAtribuicao: null,
            abertas: 0,
            ultimaAtividadeEm: m.ultimaAtividadeEm,
        },
        politica.minutosParaAusente
    )
}

/**
 * Quando alguém fica disponível, a fila sem dono encontra responsável.
 *
 * **Este é o momento em que a madrugada vira carteira.** Com o interruptor
 * ligado e ninguém disponível, as conversas da noite nascem órfãs; sem esta
 * varredura ficariam assim até a mensagem seguinte do paciente — que pode não
 * vir. Quem abre o sistema às 8h encontra o que fazer, que era o pedido.
 *
 * **Uma de cada vez, com teto.** Distribuir o lote inteiro faria a primeira
 * pessoa a chegar levar a noite toda, e a segunda chegar meia hora depois para
 * uma fila vazia. Com o teto, o resto espera mais gente ficar disponível — ou a
 * própria pessoa esvaziar o que pegou e voltar a puxar.
 *
 * Reusa `escolherDono` a cada volta em vez de atribuir tudo a quem acabou de
 * chegar: se outra pessoa ficar disponível no meio, ela entra no rodízio.
 *
 * Nunca lança: é chamada sem `await` de uma rota que já respondeu.
 */
export async function varrerFilaSemDono(workspaceId: string, gatilho: string): Promise<number> {
    /**
     * O teto não é configurável de propósito. É proteção contra o caso
     * patológico (uma noite de 40 conversas), não um ajuste de operação — e
     * cada número que o cliente pode mexer é um número que ele precisa
     * entender.
     */
    const TETO = 5

    try {
        const politica = await politicaDo(workspaceId)
        if (politica.estrategia === 'nenhuma') return 0

        const semDono = await prisma.conversation.findMany({
            where: { workspaceId, ownerId: null, status: 'active' },
            select: { id: true, integrationId: true },
            orderBy: { createdAt: 'asc' },
            take: TETO,
        })
        if (semDono.length === 0) return 0

        let deu = 0
        for (const c of semDono) {
            const quem = await darDono({
                workspaceId,
                conversationId: c.id,
                integrationId: c.integrationId,
            })
            if (quem) deu++
        }

        if (deu > 0) log.info(`${deu} conversa(s) sem dono distribuída(s) após ${gatilho} ficar disponível`)
        return deu
    } catch (erro) {
        log.warn(`varredura da fila falhou em ${workspaceId}: ${String(erro)}`)
        return 0
    }
}
