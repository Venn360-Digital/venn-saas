# E-010 ClosingNote
Product term: Closing Notes · Parent: E-002 Conversation · Status: draft

## Fields
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| category | string | sim | — | categoria pré-definida (Settings) | [doc SRC-028] |
| description | string | não | — | resumo livre | [doc SRC-028] |

Aplicada ao fechar conversa (`/conversation/status` com `category`/`summary`). Lista em `/space/closing_notes`. [doc SRC-028]
Categorias default observadas (Settings > Conversas > "Categoria de conversa"): **General Inquiry · Others · Payment Issue · Sales Inquiry** (geridas em "Administrar"). A IA pode **selecionar a categoria e gerar o resumo automaticamente** ao encerrar. [obs EV-017]

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| conversa | E-002 Conversation | o1—1 | — | [doc SRC-028] |

## Lifecycle
Categorias definidas em Settings; nota criada ao fechar a conversa. A observar (F-011/F-083).

## System fields
| Field | Set when | Source |
|---|---|---|
| (registro) | ao fechar conversa | [doc SRC-028] |

## Rules
- (F-011: closing note é obrigatória ao fechar? quais categorias default?)

## Not tested
- Obrigatoriedade; categorias default; relatório de closing notes.
