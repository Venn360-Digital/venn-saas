# S-003 Inbox (Messages)
Features: F-010..F-020, F-038 · URL: `/space/:id/inbox` · `/space/:id/inbox/:conversationId` · Status: draft

## Purpose
Central de atendimento: gerenciar todas as conversas (chat e chamadas) de todos os canais numa caixa de entrada unificada, atribuir, colaborar e fechar.

## Entry points
- Nav lateral "inbox". Abrir uma conversa muda a URL para `/inbox/:conversationId`. [obs EV-007]

## Anatomy
Layout de 3 painéis [obs EV-007]:

| # | Region | Contents | Evidence |
|---|---|---|---|
| 1 | Painel esquerdo (inboxes) | Filtros: Todos, Minhas, Colaborações, Não atribuídas; Chamadas recebidas; Ciclo de vida (inboxes por estágio); Caixa de entrada de equipe; Caixa de entrada personalizada; Contatos bloqueados | [obs EV-007] |
| 2 | Lista de conversas | cartões (contato, canal, prévia, tempo, status, nº não lidas) | [net EV-007] |
| 3 | Conversa (centro) | timeline (chat-activity: mensagens + atividades) + barra de composição | [net EV-007] |
| 4 | Painel direito (contato) | abas: Detalhes (#tab-details), Chamadas (#tab-calls), Arquivos (#tab-files), Atividades (#tab-activities) | [obs EV-007] |
| 5 | Barra de composição | seletor de canal ("Nenhum canal selecionado"), AI Assist, Adicionar comentário, Resumir, FECHAR (fechar conversa) | [obs EV-007] |

## Data shown

| Element | Entity.field | Evidence |
|---|---|---|
| Cartão de conversa | Contact.fullName/profilePic, Channel.source, Message.payload.text, unreadMessageCount, status | [net EV-007] |
| Timeline | chat-activity (type=message/activity), sender.source, traffic | [net EV-007] |
| Painel contato | Contact + contactChannels (messageWindowExpiry, call_permission) | [net EV-007] |

## States

| State | How to reach it | What it shows | Evidence |
|---|---|---|---|
| Lista carregada | abrir /inbox | conversas por filtro | [net EV-007] |
| Conversa aberta | clicar conversa | timeline + composição; marca como lida | [net EV-007] |
| Inbox de equipe/personalizada vazia | sem inbox criada | "Nenhuma caixa de entrada criada" | [obs EV-007] |
| Loading | navegação | alerts "Carregando..." | [obs EV-007] |
| Plan-gated (AI Assist) | — | AI Assist requer Growth+ | [doc SRC-017] |

## Interactions

| Trigger | Result | Request | Persistence scope | Evidence |
|---|---|---|---|---|
| Clicar filtro (Todos/Minhas/...) | recarrega lista | POST /api/v2/conversation/list | view | [net EV-007] |
| Abrir conversa | carrega contato+timeline; **marca como lida** | GET /contact/:id, /contact/:id/channels, /chat-activity | workspace (read state) | [net EV-007] |
| FECHAR | fecha conversa (+ closing note) | (não exercitado) | workspace | [obs EV-007] |
| Enviar mensagem | **não exercitado (proibido pelo usuário)** | POST /contact/:id/message | — | — |
| Resumir / AI Assist | ações de IA (não exercitado) | — | — | [obs EV-007] |

## Keyboard and accessibility

| Check | Result | Evidence |
|---|---|---|
| Command palette | Cmd/Ctrl+K abre pesquisa global (tooltip no app) | [obs EV-007] |
| Atalhos Inbox | Ctrl+Q fechar, Ctrl+M atribuir, Ctrl+U snooze, Ctrl+L lifecycle, Ctrl+S snippets | [doc SRC-009] |
| Unlabeled controls | muitos botões sem nome acessível | [obs EV-007] |

## Microcopy

| Element | Text | Evidence |
|---|---|---|
| Filtros | Todos · Minhas · Colaborações · Não atribuidas | [obs EV-007] |
| Composição | "Nenhum canal selecionado", "AI Assist", "Adicionar comentário", "Resumir", "FECHAR" | [obs EV-007] |
| Inbox vazia | "Nenhuma caixa de entrada criada" | [obs EV-007] |

## Rules
- R-006, R-007, R-008 (ver rules/inbox.md)

## Realtime and performance

| Check | Result | Evidence |
|---|---|---|
| Realtime | app mantém WebSocket (recorder viu WS) + polling; mensagens novas chegam sem reload | [net EV-007] |
| Loading pattern | alerts "Carregando..." (skeleton) | [obs EV-007] |

## Not tested
- Envio de mensagem (proibido) e seus estados (pending/sent/delivered/read).
- Snooze/auto-close na UI; atribuição; closing note ao fechar.
- Custom inbox e team inbox (nenhuma criada); criação delas.
- Chamadas (widget "Chamando..." presente; não interagido).
- Responsivo/teclado completos.
