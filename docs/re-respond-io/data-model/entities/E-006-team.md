# E-006 Team
Product term: Team · Parent: none · Status: draft

## Fields
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sim | — | — | [doc SRC-028] |
| name | string | sim | — | — | [doc SRC-028] |

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| membros | E-005 User | 1—N | set null | [doc SRC-028] |

## Lifecycle
Criado em Settings > Teams; usado em roteamento/atribuição (Assign To). A observar (F-083).

## System fields
| Field | Set when | Source |
|---|---|---|
| id | na criação | [doc SRC-028] |

## Rules
- (roteamento por time no Workflow Assign To — F-064)

## Not tested
- Limites de nº de times por plano; relação time↔inbox/custom inbox.
