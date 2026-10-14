import 'server-only'
import { NextResponse } from 'next/server'
import {
    MANAGER_ROLES,
    assertAgentAccess,
    getWorkspaceMember,
    requireRole,
    type WorkspaceMember,
    type WorkspaceRole,
} from './workspace'

/**
 * Autorização das rotas do agente, num lugar só.
 *
 * As treze rotas sob `/api/agents` repetiam, cada uma, a sua própria versão
 * disto — e nenhuma versão conferia duas coisas. Não filtravam `isActive`, então
 * desativar alguém em Gerenciamento → Usuários não revogava nada; e não liam o
 * perfil, então um **atendente** podia conectar e desconectar o WhatsApp da
 * clínica, apagar a base de conhecimento inteira, trocar as regras e os
 * webhooks. Só `PATCH` e `DELETE` do próprio agente exigiam dono ou
 * administrador.
 *
 * A divisão é entre ler e mexer. Ler é de qualquer membro ativo, porque a tela
 * de Agentes aparece no menu de todos os perfis e saber qual agente atende o quê
 * é parte do trabalho de quem atende. Mexer é de gestão — é configuração da
 * clínica, não trabalho do dia.
 */

export type AgentAuth = { ok: true; member: WorkspaceMember } | { ok: false; response: NextResponse }

async function check(agentId: string, roles: WorkspaceRole[] | null): Promise<AgentAuth> {
    const auth = roles ? await requireRole(roles) : await getWorkspaceMember()
    if (!auth.ok) {
        return {
            ok: false,
            response: NextResponse.json({ error: auth.error }, { status: auth.status }),
        }
    }
    if (!(await assertAgentAccess(agentId, auth.member.workspaceId))) {
        // 404 e não 403: um agente de outra clínica não existe para esta.
        return {
            ok: false,
            response: NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 }),
        }
    }
    return { ok: true, member: auth.member }
}

/** Ler o agente: qualquer membro ativo do workspace dele. */
export function readAgent(agentId: string): Promise<AgentAuth> {
    return check(agentId, null)
}

/** Mexer no agente ou em qualquer coisa dele: gestão. */
export function manageAgent(agentId: string): Promise<AgentAuth> {
    return check(agentId, MANAGER_ROLES)
}
