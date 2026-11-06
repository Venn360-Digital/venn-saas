# E-008 CustomField
Product term: Contact Field · Parent: none · Status: draft

## Fields
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sim | — | — | [doc SRC-028] |
| name | string | sim | — | — | [doc SRC-028] |
| slug | string | não | — | gerado | [doc SRC-028] |
| description | string | não | — | — | [doc SRC-028] |
| dataType | CustomFieldDataType | sim | text | enum abaixo | [doc SRC-028] |
| allowedValues | string[] | não | — | só para `list` | [doc SRC-028] |

### Enum CustomFieldDataType
`text` · `list` · `checkbox` · `email` · `number` · `url` · `date` · `time`. [doc SRC-028]
Valor no contato: `CustomFieldValue { name, value: string|number|boolean|null }`.

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| valores | E-001 Contact (custom_fields) | 1—N | — | [doc SRC-028] |

## Lifecycle
Definido em Settings > Contact Fields. A observar (F-083).

## System fields
| Field | Set when | Source |
|---|---|---|
| id, slug | na criação | [doc SRC-028] |

## Rules
- Preenchido manualmente, por Workflow (Update Contact Field — F-065) ou por AI Skill (capturar campo).

### Campos de sistema (default) [obs EV-018]
tags (MultiValue) · profilePic (Image) · phone (Number, E.164) · lastName/firstName/language/countryCode (Text) · email (Email). Cada campo tem **Visibilidade** configurável (ex.: "Exibir sempre"). Tipos de sistema (MultiValue/Image) ≠ dataType de campo custom.

## Not tested
- Limite de campos por plano; validação por dataType; opções de Visibilidade além de "Exibir sempre".
