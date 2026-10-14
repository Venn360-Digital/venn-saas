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
    departmentId: string | null
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
            departmentId: true,
            canTransfer: true,
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
            departmentId: membership.departmentId,
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
 * departamento, e quem não é gestão vê a fila do departamento dele. Fica sempre
 * dentro do recorte o que não é de ninguém em particular — conversa sem linha e
 * linha sem departamento são a fila geral da clínica.
 *
 * Devolve `null` para "sem recorte", que é o caso da gestão e também o de um
 * atendente sem departamento: numa clínica que não usa departamentos, nada muda.
 *
 * Mora aqui, e não na rota da lista, porque esconder uma conversa da lista não é
 * autorização: o id dela na URL abre a conversa inteira.
 */
export function conversationScope(
    member: Pick<WorkspaceMember, 'role' | 'departmentId'>
): Prisma.ConversationWhereInput {
    if (canSeeEveryone(member.role) || !member.departmentId) return {}
    return {
        // Em `AND` para poder ser espalhado sobre um `where` que já tenha `OR`
        // — a busca por texto usa `OR`, e as duas condições têm que valer
        // juntas: "da minha fila" **e** "que casa com a busca".
        AND: [
            {
                OR: [
                    { integration: { departmentId: member.departmentId } },
                    { integration: { departmentId: null } },
                    { integrationId: null },
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
