import 'server-only'
import { NextResponse } from 'next/server'
import {
    MANAGER_ROLES,
    PERMISSION_DENIED,
    assertAgentAccess,
    getWorkspaceMember,
    requireRole,
    type WorkspaceMember,
    type WorkspaceRole,
} from './workspace'
import prisma from '@/lib/prisma'

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

export type WorkspaceAlvo =
    | { ok: true; workspaceId: string; member: WorkspaceMember }
    | { ok: false; response: NextResponse }

/**
 * Em qual unidade esta rota de agente age, quando a unidade vem na URL.
 *
 * `/api/agents` aceita `?workspaceId=`, e as três rotas que o faziam
 * conferiam o acesso perguntando à tabela se existe `WorkspaceUser` do
 * usuário naquela unidade. A pergunta é a errada por duas razões.
 *
 * A primeira é o operador da Venn360: a participação dele numa conta de
 * cliente é **sintética** — não há linha de `WorkspaceUser`, de propósito
 * (ver `getWorkspaceMember`). A consulta crua volta vazia, e a tela de
 * Agentes dentro da conta do cliente respondia 403 **depois** de o mesmo
 * arquivo já ter resolvido a unidade certa pelo helper, duas linhas acima.
 * Era o único assunto do produto que o console não abria.
 *
 * A segunda é que a conta assumida deixava de ser respeitada: a unidade vinha
 * do helper e a autorização vinha da tabela, então os dois podiam discordar —
 * e quando discordam, quem manda tem de ser **um** deles.
 *
 * A unidade resolvida pelo helper é a autoridade. Um `workspaceId` diferente
 * na URL só passa quando o usuário tem participação ativa de verdade nele —
 * é o caso da clínica com várias unidades, e continua funcionando. Para o
 * operador nunca passa: o cookie escolhe uma unidade, e é nela que ele está.
 */
export async function workspaceDoPedido(
    pedido: string | null,
    roles: WorkspaceRole[] | null = null,
): Promise<WorkspaceAlvo> {
    const auth = roles ? await requireRole(roles) : await getWorkspaceMember()
    if (!auth.ok) {
        return {
            ok: false,
            response: NextResponse.json({ error: auth.error }, { status: auth.status }),
        }
    }

    const member = auth.member
    const explicito = pedido && pedido !== 'current' && pedido !== 'undefined' ? pedido : null

    if (!explicito || explicito === member.workspaceId) {
        return { ok: true, workspaceId: member.workspaceId, member }
    }

    const irma = await prisma.workspaceUser.findFirst({
        where: { workspaceId: explicito, userId: member.userId, isActive: true },
        select: { id: true },
    })

    if (!irma) {
        return {
            ok: false,
            response: NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 }),
        }
    }

    return { ok: true, workspaceId: explicito, member }
}
