import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

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
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return { ok: false, status: 401, error: 'Não autenticado' }
    }

    const membership = await prisma.workspaceUser.findFirst({
        where: { userId: user.id, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: {
            userId: true,
            workspaceId: true,
            role: true,
            canTransfer: true,
            departments: { select: { departmentId: true } },
        },
    })

    if (!membership) {
        // Either no workspace at all, or every membership is deactivated. Both mean
        // "no access"; the onboarding flow handles the first case.
        return { ok: false, status: 404, error: 'Workspace não encontrado' }
    }

    return {
        ok: true,
        member: {
            userId: membership.userId,
            workspaceId: membership.workspaceId,
            role: membership.role as WorkspaceRole,
            departmentIds: membership.departments.map((d) => d.departmentId),
            canTransfer: membership.canTransfer,
        },
    }
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
