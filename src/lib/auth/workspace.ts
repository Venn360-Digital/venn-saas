import 'server-only'
import type { Prisma } from '#prisma'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { usuarioDaSessao } from '@/lib/auth/sessao'

/**
 * O cookie que guarda qual unidade a pessoa está olhando.
 *
 * Só o Multiclínica tem mais de uma, então para quase todo mundo ele nunca é
 * escrito e nada muda. Quem escreve é a troca de workspace; quem lê é
 * `getWorkspaceMember()`, e **só depois de conferir que a unidade é mesmo
 * dela** — cookie é campo de texto como qualquer outro, e aceitar o que ele diz
 * seria entregar a clínica do vizinho a quem souber editá-lo.
 */
export const WORKSPACE_COOKIE = 'odontobox.workspace'

/**
 * Workspace authorisation for API routes.
 *
 * Replaces the pattern that was copy-pasted across ~46 routes:
 *
 *     const workspaceUser = await prisma.workspaceUser.findFirst({
 *         where: { userId: user.id },
 *         select: { workspaceId: true },
 *     })
 *
 * which had three problems. It never filtered on `isActive`, so deactivating a
 * user in Gerenciamento → Usuários revoked nothing. It had no `orderBy`, so a user
 * belonging to more than one workspace got an arbitrary one — and could therefore
 * read from one workspace and write to another between two requests. And it
 * discarded `role`, which is why most routes enforce no permissions at all.
 */

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'GESTOR' | 'ATENDENTE'

/** Roles allowed to manage workspace configuration and other members. */
export const MANAGER_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN']

/** Roles allowed to change shared records (pipelines, products, tags, …). */
export const EDITOR_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'GESTOR']

export const PERMISSION_DENIED = 'Você não tem permissão para esta ação'

/**
 * Whether a role may change records that are shared across the workspace.
 *
 * Two kinds of record are gated by this, for different reasons:
 *
 *   - Workspace configuration — products, departments, tags, pipeline stages,
 *     custom fields, quick responses, agencies, media sources. These are setup,
 *     not daily work, and an ATENDENTE editing a pipeline stage changes the board
 *     for everyone.
 *   - Deletion of operational records — contacts, deals, activities. Creating and
 *     editing those *is* the attendant's job, so only removal is held back; a
 *     deleted contact takes its conversations and deals with it.
 *
 * Hiding a menu is not authorisation: the sidebar already gated these sections by
 * role while the API accepted the call from anyone.
 */
export function hasEditorRole(role: string): boolean {
    return (EDITOR_ROLES as string[]).includes(role)
}

export interface WorkspaceMember {
    /** O id da linha de participação — `WorkspaceUser.id`, não o do usuário. */
    membershipId: string
    userId: string
    workspaceId: string
    role: WorkspaceRole
    /**
     * De quais departamentos esta pessoa é. Vazio é legítimo: clínica que não
     * usa departamentos tem todo mundo assim, e nesse caso o recorte de
     * conversa não recorta nada — ver `conversationScope`.
     */
    departmentIds: string[]
    canTransfer: boolean
    /**
     * `disponivel | ocupado | ausente`. Só a própria pessoa muda o seu.
     *
     * Lido em dois lugares com perguntas diferentes: a **distribuição** só olha
     * quando `soDisponiveis` está ligado na política; a **entrega no handoff**
     * olha sempre. Ver §11.3 do estudo.
     */
    status: string
    /** Entra na distribuição de conversas. Marca por pessoa, não pelo papel. */
    recebeConversas: boolean
    /** Última ação no sistema. É daqui que sai a queda automática para ausente. */
    ultimaAtividadeEm: Date | null
}

/** Why authorisation failed, so the caller can pick the right status code. */
export type AuthFailure =
    | { ok: false; status: 401; error: string }
    | { ok: false; status: 403; error: string }
    | { ok: false; status: 404; error: string }

export type AuthResult = { ok: true; member: WorkspaceMember } | AuthFailure

/**
 * Resolve the caller's active workspace membership.
 *
 * Picks the oldest membership when a user belongs to several, so the choice is at
 * least stable until a workspace selector exists.
 */
export async function getWorkspaceMember(): Promise<AuthResult> {
    // Quem é a pessoa sai de `lib/auth/sessao.ts`, que é o único lugar que sabe
    // como isso é descoberto. Aqui só interessa o que ela pode.
    const user = await usuarioDaSessao()

    if (!user) {
        return { ok: false, status: 401, error: 'Não autenticado' }
    }

    const SELECT = {
        id: true,
        userId: true,
        workspaceId: true,
        role: true,
        canTransfer: true,
        // Disponibilidade e se entra na distribuição. Saem daqui porque toda
        // rota autenticada já faz esta consulta — pedi-los de novo noutro lugar
        // seria uma segunda ida ao banco pelo que já está na mão.
        status: true,
        recebeConversas: true,
        ultimaAtividadeEm: true,
        departments: { select: { departmentId: true } },
    } as const

    /**
     * A unidade escolhida, quando há uma e quando ela é mesmo desta pessoa.
     *
     * A consulta já carrega o `workspaceId` do cookie: se a pessoa não
     * participa daquela unidade — cookie forjado, acesso removido, conta
     * trocada no mesmo navegador —, não volta linha nenhuma e a escolha é
     * ignorada. Não existe caminho em que o cookie decida sozinho.
     */
    const escolhido = (await cookies()).get(WORKSPACE_COOKIE)?.value

    /**
     * Unidade suspensa não é escolhível — nem pelo cookie, nem por omissão.
     *
     * É aqui que a suspensão vira acesso negado, e é um ponto só: toda rota e
     * toda página passam por esta função. Sem este filtro, suspender uma
     * unidade a tiraria da tela de seleção e deixaria o cookie antigo continuar
     * abrindo-a.
     *
     * Ninguém fica preso por causa disto: suspender é recusado quando algum
     * membro participa **só** daquela unidade (ver a rota de suspensão), então
     * sempre sobra uma no ar para a escolha por omissão encontrar.
     */
    const noAr = { workspace: { suspendedAt: null } }

    let membership = escolhido
        ? await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true, workspaceId: escolhido, ...noAr },
            select: SELECT,
        })
        : null

    // Sem escolha válida, a de sempre: a participação mais antiga. É o que
    // valia antes do seletor existir, e continua valendo para quem tem uma só.
    membership ??= await prisma.workspaceUser.findFirst({
        where: { userId: user.id, isActive: true, ...noAr },
        orderBy: { createdAt: 'asc' },
        select: SELECT,
    })

    if (!membership) {
        // Either no workspace at all, or every membership is deactivated. Both mean
        // "no access"; the onboarding flow handles the first case.
        return { ok: false, status: 404, error: 'Workspace não encontrado' }
    }

    /**
     * O toque de atividade — o único lugar da aplicação que o faz.
     *
     * Toda rota e toda página passam por esta função, então aqui é onde
     * "esta pessoa está usando o sistema" é um fato, e não uma inferência. É
     * o sinal que sustenta a queda automática para ausente: sem ele, quem sai
     * às 18h esquecendo o status continuaria recebendo conversa de madrugada.
     *
     * **Com folga, e esta é a parte que importa.** Escrever a cada requisição
     * poria um UPDATE no caminho mais quente do produto, e num Worker cada
     * escrita é conexão segurada no Neon (ver a memória sobre o cliente por
     * requisição). Só reescreve quando o valor já está velho — uma escrita a
     * cada poucos minutos por pessoa, não por clique.
     *
     * Sem `await` de propósito: a resposta não espera por isto, e perder um
     * toque não tem consequência — o próximo pedido refaz. Por isso também não
     * tem `catch` que faça algo: falhar aqui não pode derrubar autenticação.
     */
    const FOLGA_MS = 5 * 60_000
    const agora = Date.now()

    /**
     * **Voltar ao sistema devolve ao verde — e só a quem estava desconectado.**
     *
     * É assim que "logar já vem disponível" acontece sem cirurgia no Better
     * Auth: o logout grava `desconectado`, e o primeiro pedido autenticado
     * depois encontra esse estado e o desfaz. Vale também para quem a escada
     * levou a cinza por 8 horas parado — voltou, está de volta.
     *
     * **Não toca em quem escolheu `ocupado` ou `ausente`**, e é justamente aqui
     * que a escolha manual se prova pegajosa: sem esta condição, quem se marca
     * ocupado para uma reunião voltaria a verde ao abrir o sistema para
     * conferir um horário — e receberia lead no meio da reunião.
     */
    const voltou = membership.status === 'desconectado'

    if (
        voltou ||
        (membership.status === 'disponivel' &&
            (!membership.ultimaAtividadeEm || agora - membership.ultimaAtividadeEm.getTime() > FOLGA_MS))
    ) {
        void prisma.workspaceUser
            .update({
                where: { id: membership.id },
                data: {
                    ultimaAtividadeEm: new Date(agora),
                    ...(voltou ? { status: 'disponivel', statusEm: new Date(agora) } : {}),
                },
            })
            .catch(() => { /* o próximo pedido tenta de novo */ })
    }

    // A leitura desta requisição já reflete a volta: esperar o próximo pedido
    // mostraria "desconectado" na tela de quem acabou de entrar.
    const statusAgora = voltou ? 'disponivel' : membership.status

    return {
        ok: true,
        member: {
            membershipId: membership.id,
            userId: membership.userId,
            workspaceId: membership.workspaceId,
            role: membership.role as WorkspaceRole,
            departmentIds: membership.departments.map((d) => d.departmentId),
            canTransfer: membership.canTransfer,
            /** `disponivel | ocupado | ausente`. Ver §11.3.3 do estudo. */
            status: statusAgora,
            recebeConversas: membership.recebeConversas,
            ultimaAtividadeEm: membership.ultimaAtividadeEm,
        },
    }
}

/**
 * A participação ativa, crua — ou `null`.
 *
 * Mesma resolução de `getWorkspaceMember()`, incluindo a unidade escolhida e a
 * conferência de que ela é mesmo desta pessoa. A diferença é só a forma da
 * resposta: aqui vem o membro ou nada, para as dezenas de rotas que já têm o
 * próprio 401 e o próprio 404 escritos.
 *
 * **As duas portas existem para que não exista uma terceira.** Enquanto cada
 * rota resolvia a participação sozinha, com `findFirst` e "a mais antiga", a
 * escolha de unidade não tinha como chegar nelas — e com três unidades por
 * conta isso deixa de ser detalhe e vira a clínica errada na tela. Quem
 * resolve participação é este arquivo; `scripts/lint-workspace.mjs` reprova o
 * build se aparecer outro.
 */
export async function currentMembership(): Promise<WorkspaceMember | null> {
    const result = await getWorkspaceMember()
    return result.ok ? result.member : null
}

/** Resolve membership and require one of `roles`. */
export async function requireRole(roles: WorkspaceRole[]): Promise<AuthResult> {
    const result = await getWorkspaceMember()
    if (!result.ok) return result

    if (!roles.includes(result.member.role)) {
        return {
            ok: false,
            status: 403,
            error: 'Você não tem permissão para esta ação',
        }
    }

    return result
}

/**
 * Quais conversas este membro pode ver, por departamento.
 *
 * O recorte é a **linha** por onde a conversa entrou: ela pertence a um
 * departamento, e quem não é gestão vê as filas dos departamentos dele. Fica
 * sempre dentro do recorte o que não é de ninguém em particular — conversa sem
 * linha e linha sem departamento são a fila geral da clínica.
 *
 * **Não existe parâmetro para ligar ou desligar isto.** A lista de
 * departamentos da clínica é o botão, e a fórmula se neutraliza sozinha: numa
 * clínica sem departamento nenhum, toda linha tem `departmentId` nulo, então
 * `linha sem departamento OR sem linha` casa com todas as conversas e o recorte
 * não recorta nada. Nada muda para quem não usa a função.
 *
 * E **fecha em vez de abrir**: atendente sem departamento numa clínica que *tem*
 * departamentos cai no `in []`, que não casa com nada, e sobra para ele a fila
 * geral. Antes esse caso devolvia "vê tudo" — e errar para o lado de mostrar
 * demais não dá sintoma, então ninguém descobria. Ele não fica cego: no instante
 * em que recebe um departamento, vê a fila dele.
 *
 * Mora aqui, e não na rota da lista, porque esconder uma conversa da lista não é
 * autorização: o id dela na URL abre a conversa inteira.
 */
export function conversationScope(
    member: Pick<WorkspaceMember, 'role' | 'departmentIds'>
): Prisma.ConversationWhereInput {
    if (canSeeEveryone(member.role)) return {}
    return {
        // Em `AND` para poder ser espalhado sobre um `where` que já tenha `OR`
        // — a busca por texto usa `OR`, e as duas condições têm que valer
        // juntas: "da minha fila" **e** "que casa com a busca".
        AND: [
            {
                OR: [
                    { integration: { departmentId: { in: member.departmentIds } } },
                    { integration: { departmentId: null } },
                    { integrationId: null },
                ],
            },
        ],
    }
}

/**
 * Quais negócios este membro pode ver.
 *
 * O eixo aqui é o **responsável**, não o departamento: negócio não tem linha, e
 * quem cuida dele é uma pessoa. Atendente vê o que é dele.
 *
 * A segunda cláusula é o que tornava este recorte impossível antes: o negócio
 * que nasce da primeira mensagem do paciente é criado pelo worker **sem dono** —
 * não há pessoa nenhuma no momento em que a mensagem chega. Recortar só por
 * `userId` esconderia justamente o lead que acabou de entrar, que é a maioria.
 *
 * Então negócio sem dono é lead não assumido, e aparece para quem pode assumir:
 * o recorte passa pela conversa do paciente, com a mesma regra de fila. O que
 * fecha essa janela é o dono chegar — ao assumir a conversa, ao cadastrar pelo
 * menu (onde o responsável é obrigatório) ou ao abrir o negócio pelo chat.
 */
export function dealScope(
    member: Pick<WorkspaceMember, 'role' | 'userId' | 'departmentIds'>
): Prisma.DealWhereInput {
    if (canSeeEveryone(member.role)) return {}
    return {
        AND: [
            {
                OR: [
                    { userId: member.userId },
                    {
                        userId: null,
                        contact: { conversations: { some: conversationScope(member) } },
                    },
                ],
            },
        ],
    }
}

/**
 * Quais pacientes este membro pode ver.
 *
 * Paciente não tem dono — e não vai ter: um quarto campo de responsável seria um
 * quarto lugar para dessincronizar. Então o recorte é **derivado**: é dele o
 * paciente de quem ele cuida o negócio, ou com quem ele está conversando, ou que
 * escreveu para uma fila que é dele.
 *
 * A consequência, que é decisão e não falha: paciente cadastrado pela gestão que
 * nunca escreveu e não tem negócio de ninguém fica invisível para o atendente —
 * a mesma regra que já vale para atividade sem responsável.
 *
 * As duas primeiras cláusulas não se somam por engano: conversa transferida para
 * ele pode vir de uma linha de departamento que não é dele, e aí a terceira não
 * a alcança.
 */
export function contactScope(
    member: Pick<WorkspaceMember, 'role' | 'userId' | 'departmentIds'>
): Prisma.ContactWhereInput {
    if (canSeeEveryone(member.role)) return {}
    return {
        AND: [
            {
                OR: [
                    { deals: { some: { userId: member.userId } } },
                    { conversations: { some: { assignedTo: member.userId } } },
                    { conversations: { some: conversationScope(member) } },
                ],
            },
        ],
    }
}

/**
 * Confirm a conversation belongs to the caller's workspace — e à fila dele.
 *
 * Several conversation sub-routes took the id straight from the URL and acted on
 * it — which let any authenticated user mark another tenant's conversation as
 * read, read and edit its tags, and trigger a WhatsApp typing indicator against
 * their contact's real number.
 *
 * Passando o membro em vez do workspace, a mesma checagem também aplica o
 * recorte por departamento. A forma antiga (só o id do workspace) continua
 * aceita para as rotas que não têm o membro em mãos.
 */
export async function assertConversationAccess(
    conversationId: string,
    scope: string | WorkspaceMember
): Promise<boolean> {
    const workspaceId = typeof scope === 'string' ? scope : scope.workspaceId
    const conversation = await prisma.conversation.findFirst({
        where: {
            id: conversationId,
            workspaceId,
            ...(typeof scope === 'string' ? {} : conversationScope(scope)),
        },
        select: { id: true },
    })
    return conversation !== null
}

/** Confirm an agent belongs to the caller's workspace. */
export async function assertAgentAccess(
    agentId: string,
    workspaceId: string
): Promise<boolean> {
    const agent = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId },
        select: { id: true },
    })
    return agent !== null
}

/**
 * Perfis que podem ver o trabalho de outra pessoa.
 *
 * Gestão (dono, administrador, gestor) escolhe entre "Todos" e um responsável;
 * atendente vê o próprio trabalho e nada mais — seus pacientes, suas mensagens,
 * seus negócios, suas conversas, suas atividades. É a mesma lista de perfis de
 * `EDITOR_ROLES`, mas nomeada pelo que decide: não é sobre poder editar, é
 * sobre poder olhar.
 */
export const OVERSIGHT_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'GESTOR']

/** Se este perfil pode pedir os dados de todo o workspace. */
export function canSeeEveryone(role: string): boolean {
    return (OVERSIGHT_ROLES as string[]).includes(role)
}

/**
 * Qual responsável os dados devem respeitar.
 *
 * Devolve `null` para "todos" e um `userId` quando o recorte é de uma pessoa.
 * Um atendente recebe sempre o próprio id, **independente do que pediu** — por
 * isso esta função existe no servidor: esconder o seletor na tela não é
 * autorização, e `?userId=` na URL é um campo de texto como qualquer outro.
 */
export function resolveOwnerScope(
    member: WorkspaceMember,
    requested: string | null | undefined
): string | null {
    if (!canSeeEveryone(member.role)) return member.userId
    if (!requested || requested === 'all') return null
    return requested
}
