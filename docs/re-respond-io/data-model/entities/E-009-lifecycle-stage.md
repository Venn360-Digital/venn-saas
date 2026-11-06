# E-009 LifecycleStage
Product term: Lifecycle / Lifecycle Stage · Parent: none · Status: draft (UI a observar — Q-010)

## Fields (confirmado no editor de Settings > Lifecycle)
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id (lifecycleId) | number | sistema | — | referenciado no contato como `lifecycleId` (FK) | [net EV-007] |
| name | string | sim | — | "Nome da etapa" | [obs EV-006] |
| emoji | string | não | — | ícone do estágio (🆕🔥💵🤩 / 🧊) | [obs EV-006] |
| description | string | não | — | opcional ("Exibir descrição") | [obs EV-006] |
| order | number | sim | — | posição (arrastar p/ reordenar) | [obs EV-006] |
| group | enum | sim | funnel | **`funnel`** (ciclo de vida) \| **`loss`** (perda) | [obs EV-006] |
| flag | enum | não | — | `default` (1ª etapa do funil) \| `closed_won` (última do funil, 🏆) | [obs EV-006] |

**Estrutura observada (2 grupos):**
- **Funil** (ganho): 🆕 New Lead (`default`) → 🔥 Hot Lead → 💵 Payment → 🤩 Customer (`closed_won`/"Venda Fechada"). Cada etapa do funil **cria automaticamente uma Caixa de entrada padrão** no módulo Inbox.
- **Perda** (`loss`): 🧊 Cold Lead. Etapas de perda **não** criam caixa de entrada.

Até **20 stages** [doc SRC-016]. Toggle global "Mostrar/ocultar etapas" (oculta sem apagar dados). [obs EV-006]

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| contatos no estágio | E-001 Contact (lifecycle) | 1—N | — | [doc SRC-028] |

## Lifecycle
Estágios configurados em Settings > Lifecycle; contato transita entre eles. Toda transição é registrada no **Lifecycle Transitions Log** com a fonte (agente/AI/Workflow/integração). [doc SRC-018]

## System fields
| Field | Set when | Source |
|---|---|---|
| (transição) | ao mudar estágio, grava log com fonte+timestamp | [doc SRC-018] |

## Rules
- Mudança por AI Skill, Workflow (Update Lifecycle — F-065), manual (Ctrl+L) ou integração. [doc SRC-007] [doc SRC-009]

## Not tested
- Schema exato do estágio (order/type/cor) — Q-010.
- Se há automação disparada por entrada em estágio.
- Limite real de 20 e edição/reordenação na UI (F-003/F-037).
