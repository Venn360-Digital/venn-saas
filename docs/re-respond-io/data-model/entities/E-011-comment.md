# E-011 Comment
Product term: Comment · Parent: E-001 Contact · Status: draft

## Fields
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| contactId | number | sim | — | FK → E-001 | [doc SRC-028] |
| text | string | sim | — | menção com `@[email]` | [doc SRC-028] |
| created_at | number | sistema | — | epoch | [doc SRC-028] |

Nota interna na conversa; **não é entregue ao contato**. [doc SRC-004]

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| contato/conversa | E-001 Contact | N—1 | cascade? | [doc SRC-028] |
| menção | E-005 User | N—N | — | [doc SRC-028] |

## Lifecycle
Criado no Inbox (colaboração). Menção notifica o usuário citado — **no estudo, mencionar só o operador** (menção a terceiro = A5).

## System fields
| Field | Set when | Source |
|---|---|---|
| created_at | ao criar | [doc SRC-028] |

## Rules
- (F-015: colaboração; menção dispara notificação interna)

## Not tested
- Edição/exclusão de comentário; quem vê; notificação da menção.
