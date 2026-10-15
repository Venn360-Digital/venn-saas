import { redirect } from 'next/navigation'
import { getWorkspaceMember } from '@/lib/auth/workspace'

/**
 * `/atendimento` não tem tela própria: manda para a primeira da seção.
 *
 * E qual é a primeira depende do perfil. Para quem administra é Agentes de IA;
 * para o atendente, que não tem esse item no menu, era mandá-lo justamente para
 * a tela que o menu esconde — por um atalho digitado, um favorito antigo ou o
 * histórico do navegador. Ele cai em Conversas, que é o trabalho dele.
 */
export default async function AtendimentoPage() {
    const auth = await getWorkspaceMember()
    const vêAgentes = auth.ok && ['OWNER', 'ADMIN', 'GESTOR'].includes(auth.member.role)
    redirect(vêAgentes ? '/atendimento/agentes' : '/atendimento/conversas')
}
