# E-007 Tag
Product term: Tag (SpaceTag) · Parent: none · Status: draft

## Fields
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sim | — | — | [doc SRC-028] |
| name | string | sim | — | único no workspace | [doc SRC-028] |
| description | string | não | — | — | [doc SRC-028] |
| emoji | string | não | — | — | [doc SRC-028] |
| colorCode | string | não | — | cor do rótulo | [doc SRC-028] |

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| contatos | E-001 Contact | N—N | remove associação | [doc SRC-028] |

## Lifecycle
Criada/renomeada/excluída em Settings > Tags (ou via API `/space/tag`). A observar (F-083).

## System fields
| Field | Set when | Source |
|---|---|---|
| id | na criação | [doc SRC-028] |

## Rules
- Aplicada manualmente ou por Workflow (Update Contact Tag — F-065).

## Not tested
- Limite de nº de tags; comportamento ao excluir tag em uso.
