# E-003 Message
Product term: Message · Parent: E-001 Contact · Status: draft

## Fields (GetMessageResponse)

| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| messageId | number | sim | — | id interno | [doc SRC-028] |
| channelMessageId | string\|number | sim | — | id no provedor do canal | [doc SRC-028] |
| contactId | number | sim | — | FK → E-001 | [doc SRC-028] |
| channelId | number | sim | — | FK → E-004 | [doc SRC-028] |
| traffic | enum | sim | — | `incoming`\|`outgoing` | [doc SRC-028] |
| message | Message (union) | sim | — | discriminado por `type` (abaixo) | [doc SRC-028] |
| status[] | MessageStatusEntry[] | não | — | value ∈ pending/sent/delivered/read/failed + timestamp | [doc SRC-028] |
| sender | MessageSender | não | — | source ∈ user/ai_agent/workflow/api/echo/broadcast (+ ids) | [doc SRC-028] |

### Tipos de mensagem (union por `type`)
| type | payload | enum/constraints | Source |
|---|---|---|---|
| text | {text, messageTag?} | messageTag ∈ ACCOUNT_UPDATE/POST_PURCHASE_UPDATE/CONFIRMED_EVENT_UPDATE (Messenger) | [doc SRC-028] |
| attachment | {attachment:{type,url}} | type ∈ image/video/audio/file | [doc SRC-028] |
| quick_reply | {title, replies[]} | — | [doc SRC-028] |
| email | {text, subject?, cc?, bcc?, replyToMessageId?, attachments?} | canal email | [doc SRC-028] |
| custom_payload | {payload} | canal custom | [doc SRC-028] |
| whatsapp_template | {template:{name, languageCode, components?}} | ver E-012 | [doc SRC-028] |

## Relations

| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| contato | E-001 Contact | N—1 | — | [doc SRC-028] |
| canal | E-004 Channel | N—1 | — | [doc SRC-028] |
| template | E-012 WhatsAppTemplate | N—o1 | — | [doc SRC-028] |
| origem | E-013/E-014/E-016 (broadcast/workflow/ai_agent) | N—o1 | — | [doc SRC-028] |

## Lifecycle

Status de entrega (outgoing): `pending → sent → delivered → read`; ramo de falha: `→ failed`. [doc SRC-028]

## System fields

| Field | Set when | Source |
|---|---|---|
| messageId | ao criar/receber | [doc SRC-028] |
| status[].timestamp | a cada transição de entrega | [doc SRC-028] |

## Rules

- (deep dive Inbox F-010: compor/enviar — **não exercitar envio** por restrição do usuário; documentar UI)
- Fora da janela de 24h do WhatsApp exige `whatsapp_template` aprovado [inf] Q-010.

## Not tested

- Limites de tamanho de texto/anexo por canal (não públicos) — Q-010.
- Janela de 24h do WhatsApp na prática — Q-010.
- Envio real (proibido pelo usuário): compor sem enviar.
