import 'server-only'
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
 * Confirm a conversation belongs to the caller's workspace.
 *
 * Several conversation sub-routes took the id straight from the URL and acted on
 * it — which let any authenticated user mark another tenant's conversation as
 * read, read and edit its tags, and trigger a WhatsApp typing indicator against
 * their contact's real number.
 */
export async function assertConversationAccess(
    conversationId: string,
    workspaceId: string
): Promise<boolean> {
    const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId },
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
