# E-013 Broadcast
Product term: Broadcast · Parent: none · Status: stub (sem API pública — detalhar no deep dive F-050..F-053)

## Fields (hipótese a observar — Q-010)
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sim | — | broadcastHistoryId aparece na mensagem | [doc SRC-028] |
| name | string | sim | — | nome interno ("visível apenas internamente") | [obs EV-009] |
| labels | string[] | não | — | rótulos (opcional) | [obs EV-009] |
| segment (audience) | Segmento | sim | — | destinatários via **Segmento** (grupo salvo de contatos; combobox) | [obs EV-015] |
| channelType | enum | sim | — | "Canal específico" \| "Último canal de interação" | [obs EV-015] |
| channel | E-004 Channel | cond | — | se channelType=específico | [obs EV-015] |
| content | Message/template | sim | — | "Adicionar Conteúdo" (template p/ WhatsApp) | [obs EV-015] |
| deliveryTime | enum\|datetime | sim | Envie agora | "Envie agora" ou agendar | [obs EV-015] |
| pace | enum | — | Gradual | "Ritmo do broadcast" (Gradual) | [obs EV-015] |
| status | enum | sistema | Rascunho | **Rascunho · Agendado · Em progresso · Concluído · Falhou** | [obs EV-009] |

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| canal | E-004 Channel | N—1 | — | [doc SRC-011] |
| mensagens originadas | E-003 Message | 1—N (sender.source=broadcast) | — | [doc SRC-028] |

## Lifecycle
**Rascunho → Agendado → Em progresso → Concluído** (ou **Falhou**) [obs EV-009]. Views Tabela/Calendário. Criação: modal (nome interno + rótulos) → compositor. NÃO disparado (proibido pelo usuário).

## System fields
| Field | Set when | Source |
|---|---|---|
| id | ao criar | [doc SRC-028] |

## Rules
- Message limits por plano/canal [doc SRC-011] — valores a observar.

## Not tested
- Editor de conteúdo da mensagem (Adicionar Conteúdo) e passos seguintes do wizard (agendamento/ritmo/revisão).
- Limites numéricos (message limits) por plano/canal.
- **Envio real bloqueado na trial** (só "broadcast teste") — ver B-003; não exercitado.
