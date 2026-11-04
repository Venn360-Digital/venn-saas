# E-001 Contact
Product term: Contact · Parent: none · Status: draft (recon API; a confirmar por observação e rede no deep dive)

## Fields

| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sim (sistema) | — | id interno | [doc SRC-028] |
| firstName | string | sim (criação) | — | — | [doc SRC-028] |
| lastName | string\|null | não | null | — | [doc SRC-028] |
| phone | string\|null | não | null | E.164 (ex. +55…) | [doc SRC-028] |
| email | string\|null | não | null | — | [doc SRC-028] |
| language | string\|null | não | null | — | [doc SRC-028] |
| profilePic | string\|null | não | null | uri | [doc SRC-028] |
| countryCode | string\|null | não | null | — | [doc SRC-028] |
| custom_fields | CustomFieldValue[]\|null | não | null | {name, value} (ver E-008) | [doc SRC-028] |
| status | 'open'\|'close' | sistema | — | status da conversa corrente (não é lifecycle) | [doc SRC-028] |
| tags | string[] | não | [] | nomes de tags (ver E-007) | [doc SRC-028] |
| assignee | User\|null | não | null | ver E-005 | [doc SRC-028] |
| lifecycle | string\|null | não | null | estágio livre; defaults New Lead/Hot Lead/Payment/Customer [inf] Q-010 | [doc SRC-028] |
| created_at | number | sistema | — | epoch (s) | [doc SRC-028] |

Identificador aceito nas rotas: `id:{n}` | `email:{e}` | `phone:{+..}`. [doc SRC-028]

**Campos adicionais no API interno** [net EV-007]: `fullName`, `locale`, `botStatus` (bool), `assigneeUserId`, `collaboratorUserIds[]`, `isBlocked`, `hasSecondaryContact`, `lastInteraction`/`lastInteractionTime`, `statusChangedSince`, **`lifecycleId: number`** (o estágio é **FK numérica** → E-009, não string livre), e `meta{isSurveyOngoing, snoozeTill, autoCloseTill}`. Cada `contactChannels[]` traz `messageWindowExpiry` (janela 24h WhatsApp), `conversationWindowCategory`, `call_permission`, `hasPermanentCallPermission`, `lastMessage{id,text,type}`.

## Relations

| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| conversas | E-002 Conversation | 1—N | ? (confirmar) | [doc SRC-028] |
| mensagens | E-003 Message | 1—N | ? | [doc SRC-028] |
| canais | E-004 Channel (ContactChannel) | N—N | — | [doc SRC-028] |
| tags | E-007 Tag | N—N | — | [doc SRC-028] |
| comentários | E-011 Comment | 1—N | ? | [doc SRC-028] |
| assignee | E-005 User | N—1 | set null | [doc SRC-028] |
| estágio | lifecycle (E-009) | N—1 | — | [doc SRC-028] |

## Lifecycle

O Contact tem um **estágio de lifecycle** (campo `lifecycle`) que avança pelo funil (New Lead → Hot Lead → Payment → Customer; perdido: Cold Lead). Transições por agente humano, AI Agent, Workflow ou integração, registradas no **Lifecycle Transitions Log**. [doc SRC-016] [doc SRC-018] · UI a observar Q-010.
O campo `status` (open/close) reflete a conversa corrente, não o lifecycle.

## System fields

| Field | Set when | Source |
|---|---|---|
| id | na criação | [doc SRC-028] |
| created_at | na criação (epoch) | [doc SRC-028] |
| status | abre/fecha conversa | [doc SRC-028] |

## Rules

- (a definir no deep dive de Contacts/Inbox — validação de firstName obrigatório, merge, dedupe por phone/email)

## Not tested

- Validações de formulário (obrigatoriedade, formato de phone/email) — observar no produto.
- Comportamento de merge e dedupe (chave: phone? email?).
- Enum real de lifecycle do tenant e UI de transição (Q-010).
- On-delete de conversas/mensagens/comentários ao excluir contato.
