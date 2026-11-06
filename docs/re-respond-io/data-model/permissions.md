# Permissions

Papéis de usuário no workspace (enum SDK [doc SRC-028]; rótulos PT observados [obs EV-016]):
**Proprietário (Owner)** · **Administrador (Manager)** · **Representante (Agent)**.

## Papéis (observado)

| Papel | O que pode | Evidence |
|---|---|---|
| Proprietário (Owner) | Tudo no workspace (e organização/billing). | [obs EV-016] |
| Administrador (Manager) | Todos os módulos **incluindo Configurações**; **não** pode convidar/excluir outros gerentes nem excluir canais. | [obs EV-016] |
| Representante (Agent) | **Apenas mensagens** (Inbox); visibilidade de contatos opcionalmente limitada (abaixo). | [obs EV-016] |

## Restrições avançadas (flags por usuário) [obs EV-016]

| Flag (UI) | Efeito | SDK UserRestriction |
|---|---|---|
| Restringir visibilidade de contato | Vê só colaborações e contatos atribuídos (escopo: equipe do usuário / só os seus) | show_team_contacts / show_only_mine |
| Restringir recursos de chamadas | Não recebe nem inicia chamadas | (chamadas) |
| Botão de restringir fluxos de trabalho | Desativa o botão Workflows no Inbox (inclui atalhos e interromper fluxo) | restrict_shortcuts |
| Mascaramento de telefone/e-mail **[PRO]** | Não vê telefone/e-mail de nenhum contato | (masking, Advanced+) |

Outras flags do SDK não expostas neste modal (podem estar em "Alterar"/por papel): `restrict_data_export`, `restrict_contact_deletion`, `restrict_space_setting`, `restrict_space_integration`. [doc SRC-028]

## Matriz papel × ação (síntese)

| Action | Owner | Manager | Agent |
|---|---|---|---|
| Ver/responder conversas atribuídas | ✓ | ✓ | ✓ |
| Acessar todos os módulos | ✓ | ✓ | ✗ (só mensagens) |
| Configurações do workspace | ✓ | ✓ | ✗ |
| Convidar/excluir usuários | ✓ | parcial (não outros gerentes) | ✗ |
| Excluir canais | ✓ | ✗ | ✗ |
| Ver contatos de outros/equipe | ✓ | ✓ | conforme flag de visibilidade |
| Usar/interromper workflows no Inbox | ✓ | ✓ | conforme flag |
| Fazer/receber chamadas | ✓ | ✓ | conforme flag |

Evidência: [obs EV-016]. Flags finas por papel ainda a confirmar em "Alterar" (não exercitado para não mexer no Owner).
