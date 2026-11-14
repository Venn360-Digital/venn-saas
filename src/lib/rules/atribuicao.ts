import prisma from '@venn/db/cliente'

/**
 * Quem recebe uma conversa entregue à equipe.
 *
 * Era um método privado do executor de regras, e virou módulo porque passou a
 * ter **dois** chamadores: a ação `notify_human` das regras de ação e a
 * ferramenta `passar_para_equipe` do agente. Duas cópias da mesma escolha
 * divergiriam na primeira vez que o critério mudasse — e o critério vai mudar,
 * quando o dono da conversa entrar (ver §11 do estudo).
 *
 * Casca fina de propósito: a escolha é uma consulta, não uma conta. Quando
 * houver política de distribuição, a parte que decide entre candidatos nasce
 * como função pura ao lado, e esta função passa a só buscar os elegíveis.
 *
 * ## `workspaceId` é obrigatório, e não por estilo
 *
 * `WorkspaceUser` é a tabela de junção entre pessoa e clínica, e um `findFirst`
 * nela **sem** o workspace casa um membro de outra clínica — atribuindo a
 * conversa de um paciente a quem não trabalha lá. Por isso ele é parâmetro
 * exigido pelo tipo, e não um campo opcional que alguém esquece: ver a camada de
 * guarda em `lib/auth/workspace.ts`, que segue a mesma regra.
 */

export interface Destino {
    /** A clínica. Exigido: é o recorte de isolamento, não um filtro a mais. */
    workspaceId: string
    /** Uma pessoa específica. Ganha do departamento quando os dois vêm. */
    userId?: string | null
    /** Um departamento — e aí a escolha é o membro mais antigo dele. */
    departmentId?: string | null
}

/**
 * Resolve o destino para um membro ativo do workspace.
 *
 * Devolve `undefined` quando não há destino, quando a pessoa indicada não é
 * (mais) membro ativo daquele workspace, ou quando o departamento está vazio.
 * **Quem chama tem de tratar esse caso como "entregue sem responsável"**, nunca
 * como "não entregue": foi exatamente essa confusão que fazia o agente voltar a
 * responder depois de anunciar ao paciente que a equipe assumiria.
 */
export async function resolverResponsavel(destino: Destino): Promise<string | undefined> {
    const { workspaceId } = destino

    if (destino.userId) {
        const member = await prisma.workspaceUser.findFirst({
            where: { workspaceId, userId: String(destino.userId), isActive: true },
            select: { userId: true },
        })
        return member?.userId
    }

    if (destino.departmentId) {
        /**
         * Quem é **daquele** departamento, agora que uma pessoa pode ser de
         * vários: o filtro passa pela tabela de junção em vez de comparar uma
         * coluna.
         *
         * O mais antigo do departamento continua sendo a escolha — é o critério
         * que já valia antes desta extração, e trocá-lo aqui mudaria para quem
         * as regras de ação **existentes** atribuem, sem ninguém ter pedido.
         */
        const member = await prisma.workspaceUser.findFirst({
            where: {
                workspaceId,
                isActive: true,
                departments: { some: { departmentId: String(destino.departmentId) } },
            },
            select: { userId: true },
            orderBy: { createdAt: 'asc' },
        })
        return member?.userId
    }

    return undefined
}

/**
 * O responsável natural de uma conversa quando ninguém foi indicado: o
 * departamento **da linha** por onde ela entrou.
 *
 * É o que dá destino à entrega feita pelo próprio agente, que não recebe
 * parâmetro de ninguém. Conversa sem linha — intake da recepção, widget do site,
 * histórico anterior à coluna — não tem departamento, e aí a entrega fica sem
 * responsável: aparece em "Em espera" para a fila toda, que é o comportamento
 * de hoje e o certo enquanto não houver dono de conversa.
 *
 * A linha é buscada pelo id **e** pelo workspace do agente: id de linha é
 * `cuid`, não é adivinhável, mas o recorte custa nada e fecha a porta.
 */
export async function responsavelDaLinha(
    workspaceId: string,
    integrationId: string | null
): Promise<string | undefined> {
    if (!integrationId) return undefined

    const linha = await prisma.agentIntegration.findFirst({
        where: { id: integrationId, agent: { workspaceId } },
        select: { departmentId: true },
    })

    return resolverResponsavel({ workspaceId, departmentId: linha?.departmentId ?? null })
}
