import type { WorkspaceRole } from '@/hooks/usePermissions'

/**
 * O nome que a conta lê para cada papel.
 *
 * Fonte única, e é o que faltava: o rótulo estava escrito à mão em
 * `UserPanel` e em `UserFormModal`, nos dois sem `OWNER` — porque nenhuma das
 * duas telas **atribui** OWNER, só que a de Perfil precisa **exibi-lo**, e é o
 * papel do Andre em toda conta de teste. Uma terceira cópia era a que um dia
 * discordaria das outras duas.
 *
 * As duas listas de atribuição seguem donas da ordem e da descrição delas: o
 * que mora aqui é só o nome, que tem de ser o mesmo em qualquer tela.
 */
export const ROTULO_DO_PAPEL: Record<WorkspaceRole, string> = {
    OWNER: 'Proprietário',
    ADMIN: 'Administrador',
    GESTOR: 'Gestor',
    ATENDENTE: 'Atendente',
}

/**
 * Uma linha sobre o que o papel alcança — dita no Perfil, onde a pessoa vê o
 * **próprio** papel e a pergunta que ela tem é "então o que eu posso fazer?".
 *
 * Em segunda pessoa, e não em terceira: as telas de atribuição descrevem o
 * papel de outra pessoa ("Apenas as próprias conversas"); aqui descreve o de
 * quem está lendo.
 */
export const ALCANCE_DO_PAPEL: Record<WorkspaceRole, string> = {
    OWNER: 'Acesso total, incluindo a assinatura e a exclusão da conta.',
    ADMIN: 'Acesso total, incluindo conta e usuários.',
    GESTOR: 'Atendimento e vendas, sem gerenciamento.',
    ATENDENTE: 'Apenas as suas conversas e os seus registros.',
}
