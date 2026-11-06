# E-012 WhatsAppTemplate
Product term: WhatsApp Template · Parent: E-004 Channel · Status: draft

## Fields
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sim | — | — | [doc SRC-028] |
| name | string | sim | — | — | [doc SRC-028] |
| channelId | number | sim | — | FK → E-004 (canal WhatsApp) | [doc SRC-028] |
| botId | number | sim | — | — | [doc SRC-028] |
| languageCode | string | sim | — | ex. pt_BR | [doc SRC-028] |
| namespace | string | não | — | — | [doc SRC-028] |
| category | string | sim | — | marketing/utility/authentication (Meta) | [doc SRC-028] |
| status | string | não | — | status de aprovação Meta | [doc SRC-028] |
| statusDetail | string | não | — | motivo de rejeição | [doc SRC-028] |
| components | TemplateComponent[] | sim | — | header/body/footer/buttons | [doc SRC-028] |

### Enums
- TemplateComponentType: `header`·`body`·`footer`·`buttons`
- TemplateFormat (header/param): `text`·`image`·`video`·`document`·`location`
- TemplateButtonType: `quick_reply`·`phone_number`·`url`·`catalog`·`mpm` [doc SRC-028]

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| canal | E-004 Channel | N—1 | — | [doc SRC-028] |
| mensagens | E-003 Message | 1—N | — | [doc SRC-028] |

## Lifecycle
Criado e submetido à Meta → status pending → approved/rejected. Templates aprovados permitem enviar fora da janela de 24h. Ligado a BR-001 (aprovação Meta).

## System fields
| Field | Set when | Source |
|---|---|---|
| status | ao revisar pela Meta | [doc SRC-028] |

## Rules
- Mensagem fora da janela de 24h exige template aprovado [inf] Q-010.

## Not tested
- UI de criação/submissão de template; tempos de aprovação; limites por canal.
