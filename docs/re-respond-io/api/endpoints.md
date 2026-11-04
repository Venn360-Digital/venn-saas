# Endpoints

Base URL: `https://api.respond.io/v2`. Auth: `Authorization: Bearer {token}` (API Access Token em Settings > Integrations > Developer API). IDs em paths são `:id` (identifier do contato aceita `id:`, `email:` ou `phone:`). Timestamps = Unix epoch (s). Shapes e tipos apenas; sem valores reais.
Fonte dos paths: SDK oficial [doc SRC-028] (autoritativo). Onde o OpenAPI reconstruído [doc SRC-030] diverge, prevalece o SDK. Shapes a reconfirmar por `[net]` no deep dive com `api-shapes.js` (Q-010).

| Method | Template | Triggered by | Request shape | Response shape | Evidence |
|---|---|---|---|---|---|
| POST | /contact/create_or_update/:identifier | Criar/editar contato (Inbox/Contacts) | ContactFields | Contact | [doc SRC-028] |
| POST | /contact/:identifier | Criar contato | ContactFields | Contact | [doc SRC-028] |
| PUT | /contact/:identifier | Atualizar contato | ContactFields | Contact | [doc SRC-028] |
| GET | /contact/:identifier | Abrir contato | — | Contact | [doc SRC-028] |
| DELETE | /contact/:identifier | Excluir contato (permanente) | — | — | [doc SRC-028] |
| POST | /contact/list | Listar/filtrar contatos (Contacts, Segments) | ContactFilter (+ query limit, cursorId) | {items: Contact[], pagination} | [doc SRC-028] |
| POST | /contact/merge | Mesclar contatos | {contactIds: [number, number]} | Contact | [doc SRC-028] |
| POST | /contact/:identifier/lifecycle/update | Mudar estágio de lifecycle | {name: string\|null} | — | [doc SRC-028] |
| GET | /contact/:identifier/channels | Canais do contato | — | ContactChannel[] | [doc SRC-028] |
| POST | /contact/:identifier/message | Enviar mensagem (Inbox compose) | {channelId?, message: Message} | {messageId} | [doc SRC-028] |
| GET | /contact/:identifier/message/:messageId | Obter mensagem | — | GetMessageResponse | [doc SRC-028] |
| GET | /contact/:identifier/message/list | Histórico de mensagens | — | GetMessageResponse[] (paginado) | [doc SRC-028] |
| POST | /contact/:identifier/conversation/status | Abrir/fechar conversa (+ closing note) | {status: open\|close, category?, summary?} | — | [doc SRC-028] |
| POST | /contact/:identifier/conversation/assignee | Atribuir/desatribuir conversa | {assignee: id\|email\|null} | — | [doc SRC-028] |
| POST | /contact/:identifier/comment | Comentário interno | {text} | {contactId, text, created_at} | [doc SRC-028] |
| POST | /contact/:identifier/tag | Adicionar tags ao contato | string[] | — | [doc SRC-028] |
| DELETE | /contact/:identifier/tag | Remover tags do contato | string[] | — | [doc SRC-028] |
| GET | /space/user | Listar usuários do workspace | — | SpaceUser[] | [doc SRC-028] |
| GET | /space/user/:id | Obter usuário | — | SpaceUser | [doc SRC-028] |
| GET | /space/channel | Listar canais | — | SpaceChannel[] | [doc SRC-028] |
| GET | /space/channel/:channelId/template | Templates WhatsApp do canal | — | WhatsAppTemplate[] | [doc SRC-028] |
| GET | /space/custom_field | Listar custom fields | — | CustomField[] | [doc SRC-028] |
| GET | /space/custom_field/:id | Obter custom field | — | CustomField | [doc SRC-028] |
| POST | /space/custom_field | Criar custom field | CreateCustomFieldRequest | CustomField | [doc SRC-028] |
| POST | /space/tag | Criar tag no workspace | CreateSpaceTagRequest | SpaceTag | [doc SRC-028] |
| PUT | /space/tag | Atualizar tag | {currentName, ...} | SpaceTag | [doc SRC-028] |
| DELETE | /space/tag | Excluir tag | {name} | — | [doc SRC-028] |
| GET | /space/closing_notes | Listar closing notes | — | ClosingNote[] | [doc SRC-028] |

## Regras técnicas
- **Rate limit:** 5 req/s por método → HTTP 429 + header `Retry-After` (s). Enterprise negocia limites maiores. [doc SRC-031]
- **Paginação:** cursor-based — query `cursorId` + `limit` (default 10, máx 100). Shape da resposta: `{next, previous}` (SDK) vs `{cursorId, hasMore}` (OpenAPI) — divergência a confirmar [inf] Q-010. [doc SRC-028] [doc SRC-030]
- **Erros:** `{code, message}` (SDK APIError) / `{message, status}` (OpenAPI). Códigos vistos: 404, 429. [doc SRC-028]
- **Envio sem channelId** → usa o último canal interagido. [doc SRC-030]
- **Janela de 24h do WhatsApp:** não citada na API; implícita no uso de `whatsapp_template` fora da janela [inf] Q-010.

## Webhooks (Settings > Integrations > Webhooks) — HTTPS POST JSON [doc SRC-033]

| Evento (UI) | event_type | Dispara quando | Evidence |
|---|---|---|---|
| New Incoming Message | message.received | mensagem recebida | [doc SRC-032] |
| New Outgoing Message | message.sent | mensagem enviada | [doc SRC-032] |
| Conversation Opened | conversation.opened | conversa aberta | [doc SRC-033] |
| Conversation Closed | conversation.closed | conversa fechada (+ closing note) | [doc SRC-033] |
| New Contact | contact.created | novo contato | [doc SRC-033] |
| Contact Updated | contact.updated | contato atualizado | [doc SRC-033] |
| Contact Tag Updated | contact.tag.updated | tag muda | [doc SRC-033] |
| Contact Assignee Updated | contact.assignee.updated | assignee muda | [doc SRC-033] |
| New Comment | comment.created | comentário adicionado | [doc SRC-033] |
| Call Ended | call.ended | chamada encerrada | [doc SRC-032] |

- Strings `event_type` marcadas são do SDK/UI; as não confirmadas (conversation.*, contact.*) são [inf] Q-010 — confirmar no painel.
- **Assinatura/verificação (HMAC/secret) do webhook: não documentada publicamente** — observar headers de entrega no produto. Q-010.
- Payload canônico completo por evento: não público — capturar no deep dive.

## API INTERNO do app (`/api/v2`, same-origin) — observado por rede [net EV-007]

O app NÃO usa a API pública (`api.respond.io/v2`); usa um **API interno same-origin `https://app.respond.io/api/v2`**, com shapes mais ricos. O clone deve reconstruir ambos (interno p/ o app; público p/ integrações). Shapes só de estrutura (sem valores).

| Method | Template | UI action | Request (chaves) | Response (resumo) | Evidence |
|---|---|---|---|---|---|
| POST | /api/v2/conversation/list | Carregar lista do Inbox / filtros | page, filterStatus, sortBy, filter.$and[], timezone, searchType, excludeContactIds, replyStatus, search, highlight{pre_tags,post_tags} | {status, data:[{contact{...}, message{payload{message{type,text},channel{id,source}}}, unreadMessageCount}]} | [net EV-007] |
| GET | /api/v2/contact/:id | Abrir contato/conversa | — | {data:{...contact, contactChannels[{messageWindowExpiry, conversationWindowCategory, call_permission, hasPermanentCallPermission, lastMessage{...}}], meta:{isSurveyOngoing, snoozeTill, autoCloseTill}, lifecycleId}} | [net EV-007] |
| GET | /api/v2/contact/:id/channels | Canais do contato | — | {data:{connected:[{channelId, contactChannelId, source}], available:[]}} | [net EV-007] |
| GET | /api/v2/chat-activity/chat?contactId | Timeline da conversa | query contactId | {data:[{type: activity\|message, payload{message{text,type}, sender{source,type}}, conversationId, botId, traffic, timestamp}]} | [net EV-007] |
| GET | /api/v2/contact/suggested/merge/:id | Sugestões de merge (dedupe) | — | {data:[]} | [net EV-007] |

**Correções/achados do API interno [net EV-007]:**
- **`lifecycleId: number`** no contato — o estágio de lifecycle é **FK numérica** (não string livre como no SDK público). Corrige E-001/E-009.
- **Status de conversa inclui `pending`** (enum observado), além de open/close. Confirma parte do Q-010.
- **`meta.snoozeTill` e `meta.autoCloseTill`** — snooze e fechamento automático existem (datas). **`isSurveyOngoing`** (CSAT).
- **`messageWindowExpiry`** (epoch-ms) por canal — janela de 24h do WhatsApp é rastreada; `conversationWindowCategory`.
- **`call_permission` / `hasPermanentCallPermission`** — permissão de chamada por contato/canal.
- Contato traz `botStatus`, `assigneeUserId`, `collaboratorUserIds[]`, `fullName`, `locale`.
- Timeline = `/chat-activity` mistura eventos `activity` e `message`; traz `conversationId` e `botId`.
- Telemetria de terceiro observada: **Pendo** (`data.pendo.io` — guias in-app), fora do core.

## Não expostos na API pública (gerir no produto)
Criação/gestão de **canais**, **broadcasts**, **workflows**, **snippets**, **relatórios** e **AI Agents** não têm endpoint público. AI Agent aparece só como `assignee`/`sender.source='ai_agent'`; Broadcast/Workflow como `sender.source` + id. [doc SRC-028]
