# Rules: Inbox

### R-006 A lista do Inbox é filtrável por atribuição e carrega via conversation/list
- Given o Inbox
- When o usuário escolhe um filtro (Todos, Minhas, Colaborações, Não atribuídas) ou um inbox
- Then a lista recarrega via `POST /api/v2/conversation/list` com `{page, filterStatus, sortBy, filter.$and[], search, ...}`, retornando contato + última mensagem + `unreadMessageCount` por conversa
- Evidence: [net EV-007]
- Feature: F-014 · Screen: S-003

### R-007 Conversas têm estados open/pending/close, com snooze e auto-close
- Given uma conversa
- When seu estado muda
- Then `status` pode ser `open`, `pending` ou `close`; `meta.snoozeTill` adia (snooze) e `meta.autoCloseTill` agenda fechamento automático
- Evidence: [net EV-007]
- Feature: F-011 · Screen: S-003

### R-008 Abrir uma conversa a marca como lida (hidden write)
- Given uma conversa com mensagens não lidas (unreadMessageCount > 0)
- When o usuário a abre no Inbox
- Then o app carrega contato + timeline (`/chat-activity`) e zera a contagem de não lidas (marca como lida), sem botão explícito
- Evidence: [net EV-007]
- Feature: F-010 · Screen: S-003

| Probe | Input | Result | Evidence |
|---|---|---|---|
| Filtro | clique em "Todos" | POST conversation/list | [net EV-007] |
| Abrir conversa | clique no cartão | GET contact/:id + chat-activity; marca lida | [net EV-007] |
| Status enum | — | open \| pending \| close | [net EV-007] |
