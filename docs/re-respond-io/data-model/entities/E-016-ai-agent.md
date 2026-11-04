# E-016 AIAgent
Product term: AI Agent · Parent: none · Status: stub (sem API pública — detalhar no deep dive F-030..F-040)

## Fields (observado no builder)
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sistema | — | aparece como sender.source=ai_agent | [net EV-007] |
| name | string | sim | "Sem título" | nome (+ emoji) | [obs EV-008] |
| template | enum | não | scratch | Receptionist / Sales agent / Support agent / do zero | [obs EV-008] |
| instructions | text | sim | — | prompt; com "Adicionar modelos de prompt" e "Otimizar" (IA) | [obs EV-008] |
| knowledgeSources | ref[] | não | — | documentos/FAQs/links (ver E-015 e /settings/ai-knowledge-source) | [obs EV-008] |
| skills | AISkill[] | não | — | ações executáveis (abaixo) | [obs EV-008] |
| reviewStatus | enum | sistema | "Não revisado" | Não revisado → revisado | [obs EV-008] |
| status | enum | sistema | "Inativo" | Inativo (draft) → publicado/ativo | [obs EV-008] |

### AI Skills — sugeridas observadas [obs EV-008]
Atribuir ao agente ou à equipe · Encerrar conversa · Atualizar campos de contato · Atualizar estágio do ciclo de vida · Adicionar comentários · (+ "Ver mais habilidades"). Confirma recon [doc SRC-007].

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| mensagens originadas | E-003 Message | 1—N (sender.source=ai_agent) | — | [doc SRC-028] |
| knowledge | E-015 Snippet / docs | N—N | — | [doc SRC-006] |
| atua sobre | E-002 Conversation, E-009 LifecycleStage, E-008 CustomField | — | — | [doc SRC-007] |

## Lifecycle
Criado via template → customizar → Review Instructions → Test → Publish. Publicado pode responder a conversas reais — **cuidado: canal real conectado** (não publicar de forma que dispare a cliente).

## System fields
| Field | Set when | Source |
|---|---|---|
| id | ao criar | [doc SRC-028] |

## Rules
- Latência típica 10–15s [doc SRC-007]; migração de AI Objective (Workflow legado) [doc SRC-010].

## Not tested
- UI dos 6 passos; config de Knowledge Sources e Skills; modo de teste; Voice AI Agent (F-039).
