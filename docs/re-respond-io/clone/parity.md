# Parity tests

Um teste por regra que o clone deve reproduzir. Passa quando o clone mostra o mesmo comportamento. Agrupado por área.

| Test | Rule | Feature | Summary | Clone status |
|---|---|---|---|---|
| T-001 Onboarding mostra "N de 4" e destaca o passo atual com CTA | R-001 | F-001 | saudação + progresso + 4 passos | todo |
| T-002 "Conectar canal" abre catálogo por categoria (6 categorias) | R-002 | F-002 | mensagens/chamadas/SMS/e-mail/chat | todo |
| T-003 Lifecycle tem grupo funil + grupo perda, com etapa padrão e "venda fechada" | R-003 | F-003 | 2 grupos; 🏆 won; 🧊 lost | todo |
| T-004 Cada etapa do funil cria uma caixa de entrada padrão; perda não cria | R-004 | F-003 | auto-inbox por estágio | todo |
| T-005 Ocultar etapas não apaga dados do contato | R-005 | F-003 | toggle show/hide | todo |
| T-006 Lista do Inbox filtra por atribuição e carrega via conversation/list | R-006 | F-014 | Todos/Minhas/Colaborações/Não atribuídas | todo |
| T-007 Conversa tem status open/pending/close, com snooze e auto-close | R-007 | F-011 | snoozeTill/autoCloseTill | todo |
| T-008 Abrir conversa a marca como lida (zera não lidas) | R-008 | F-010 | hidden write | todo |
| T-009 Criar AI Agent (template ou do zero) nasce rascunho inativo; publicar ativa | R-009 | F-030 | Não revisado/Inativo → Publicar | todo |
| T-010 AI Skills executam ações; teste usa contato mock e não afeta config/canal | R-010 | F-032/F-035 | assign/close/update/comment | todo |
| T-011 Broadcast tem ciclo Rascunho→Agendado→Em progresso→Concluído/Falhou; views Tabela/Calendário | R-011 | F-050/F-053 | criação por nome+rótulos | todo |
| T-012 Workflows: do zero ou galeria por categoria; alguns templates exigem upgrade | R-012 | F-063 | 6 categorias, ~37 templates | todo |

> Cada teste vira um caso de aceitação no BUILD.md. "Clone status" atualiza conforme o clone implementa. Regras adicionais (envio de mensagem, fechar com closing note, triggers/steps do workflow) ficam pendentes do aprofundamento marcado "Not tested" nas telas.
