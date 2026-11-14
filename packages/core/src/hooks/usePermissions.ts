'use client'

import { useEffect, useState } from 'react'

/**
 * The current user's workspace role and what it allows.
 *
 * Client-side gating is presentation only — the API enforces the same rules — but
 * without it an ATENDENTE sees Edit and Delete buttons that answer 403.
 *
 * `loading` starts true and `role` starts null on purpose: rendering privileged
 * controls before the role is known would flash actions the user cannot perform,
 * which is how the sidebar behaved (it defaulted to ADMIN until the fetch landed).
 */

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'GESTOR' | 'ATENDENTE'

const EDITOR_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'GESTOR']
const MANAGER_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN']
/** Quem pode olhar o trabalho de outra pessoa — espelha `OVERSIGHT_ROLES`. */
const OVERSIGHT_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'GESTOR']

export interface Permissions {
    loading: boolean
    role: WorkspaceRole | null
    /** May change workspace configuration and delete operational records. */
    canEdit: boolean
    /** May manage members and account settings. */
    canManage: boolean
    /** May reassign a conversation to another operator. */
    canTransfer: boolean
    /**
     * May look at other people's work — o seletor "Responsável" só existe para
     * estes perfis. Atendente vê o próprio recorte, e o servidor impõe isso de
     * novo (`resolveOwnerScope`): isto aqui é conforto, não autorização.
     */
    canSeeEveryone: boolean
    /**
     * É OWNER do workspace da Venn360 — quem opera o produto, não quem o usa.
     *
     * Só decide o que aparece no menu; o portão de verdade está em cada rota
     * de `/api/plataforma`, com `getPlatformAdmin()`.
     */
    daPlataforma: boolean
}

export function usePermissions(): Permissions {
    const [state, setState] = useState<{
        loading: boolean
        role: WorkspaceRole | null
        canTransfer: boolean
        daPlataforma: boolean
    }>({ loading: true, role: null, canTransfer: false, daPlataforma: false })

    useEffect(() => {
        let cancelled = false

        fetch('/api/me')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return
                setState({
                    loading: false,
                    role: (data?.role as WorkspaceRole) ?? null,
                    canTransfer: Boolean(data?.canTransfer),
                    daPlataforma: Boolean(data?.plataforma),
                })
            })
            .catch(() => {
                if (!cancelled)
                    setState({ loading: false, role: null, canTransfer: false, daPlataforma: false })
            })

        return () => {
            cancelled = true
        }
    }, [])

    const { loading, role, canTransfer, daPlataforma } = state

    return {
        loading,
        role,
        canEdit: role !== null && EDITOR_ROLES.includes(role),
        canManage: role !== null && MANAGER_ROLES.includes(role),
        canTransfer,
        canSeeEveryone: role !== null && OVERSIGHT_ROLES.includes(role),
        daPlataforma,
    }
}
