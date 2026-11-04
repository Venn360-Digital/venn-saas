# E-005 User
Product term: User / SpaceUser (membro do workspace) · Parent: none · Status: draft

## Fields

| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sim | — | id do usuário | [doc SRC-028] |
| firstName | string | sim | — | — | [doc SRC-028] |
| lastName | string | sim | — | — | [doc SRC-028] |
| email | string | sim | — | login | [doc SRC-028] |
| role | UserRole | sim | agent | `agent`\|`manager`\|`owner` | [doc SRC-028] |
| team | Team\|null | não | null | ver E-006 | [doc SRC-028] |
| restrictions | UserRestriction[] | não | [] | enum abaixo | [doc SRC-028] |

### Enum UserRestriction
`restrict_data_export` · `restrict_contact_deletion` · `restrict_space_setting` · `show_team_contacts` · `show_only_mine` · `restrict_space_integration` · `restrict_shortcuts`. [doc SRC-028]

## Relations

| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| time | E-006 Team | N—1 | set null | [doc SRC-028] |
| contatos atribuídos | E-001 Contact | 1—N (assignee) | set null | [doc SRC-028] |

## Lifecycle

Convidado → ativo (aceita convite) → removido. **Convites são A5 e proibidos pelo usuário**: no estudo, documentar a UI de convite read-only (F-005 blocked).

## System fields

| Field | Set when | Source |
|---|---|---|
| id | ao criar usuário | [doc SRC-028] |

## Rules

- Permissões por papel/flag: ver `data-model/permissions.md` (matriz a observar, Q-011).

## Not tested

- Fluxo de convite (proibido — F-005 blocked).
- Papel vs. nível de assinatura (seats) por plano.
- Mapeamento exato papel × ação (Q-011).
