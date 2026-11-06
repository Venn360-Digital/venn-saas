# S-002 Onboarding
Features: F-001, F-002, F-003, F-004, F-005 · URL: `/space/:id/onboarding` · Status: draft

## Purpose
Guiar o novo usuário pelos 4 passos iniciais para pôr o produto em uso: conectar canais, entender lifecycle, criar AI Agents e convidar colegas. Entrada também pelo botão global "Checklist de onboarding". [obs EV-005]

## Entry points
- Item de navegação "onboarding" (topo da nav lateral).
- Botão global "Checklist de onboarding" (barra superior). [obs EV-005]

## Anatomy
Anatomia observada (evidência textual — ambiente não persiste screenshot): [obs EV-005].

| # | Region | Contents | Component | Evidence |
|---|---|---|---|---|
| 1 | Banner de trial | "período de teste do plano Growth termina…" + "Atualize agora" | — | [obs EV-005] |
| 2 | Cabeçalho | "👋 Olá, {nome}! Vamos começar." + progresso "2 de 4" | — | [obs EV-005] |
| 3 | Lista de passos | 4 cartões de passo (título + descrição); passo atual com CTA | — | [obs EV-005] |
| 4 | Recursos | intro da inbox, suporte, demo, central de ajuda, vídeos | — | [obs EV-005] |

## Data shown

| Element | Entity.field | Evidence |
|---|---|---|
| Saudação | User.firstName | [obs EV-005] |
| Progresso "N de 4" | nº de passos concluídos | [obs EV-005] |

## States

| State | How to reach it | What it shows | Evidence |
|---|---|---|---|
| Em progresso | conta nova parcial | "2 de 4", passo atual com CTA | [obs EV-005] |
| Empty | — | não observado (conta já tem progresso) | — |
| Loading | navegação | SPA monta após spinner | [obs EV-005] |
| Completo (4/4) | concluir os 4 passos | não observado | — |
| Error / No permission / Plan-gated | — | não observado | — |

## Interactions

| Trigger | Result | Request | Persistence scope | Evidence |
|---|---|---|---|---|
| Clicar "Conectar canal" | Abre `/settings/channels/connect/all` em **nova aba** | navegação | — | [obs EV-005] |
| Clicar demais passos | (não exercitado — levam a lifecycle/ai-agents/convite) | — | — | [obs EV-005] |

## Keyboard and accessibility

| Check | Result | Evidence |
|---|---|---|
| Tab order | não testado | — |
| Focus visible | não testado | — |
| Escape | não testado | — |
| Unlabeled controls | vários botões sem rótulo acessível na nav (refs sem nome) | [obs EV-002] |

## Microcopy

| Element | Text | Evidence |
|---|---|---|
| Cabeçalho | "Olá, {nome}! Vamos começar." | [obs EV-005] |
| Passo 1 | "Conecte canais para unificar mensagens e chamadas" | [obs EV-005] |
| Passo 2 | "Saiba como o ciclo de vida ajuda a transformar potenciais compradores em clientes" | [obs EV-005] |
| Passo 3 | "Crie Agentes de IA para aliviar a carga de trabalho da sua equipe" | [obs EV-005] |
| Passo 4 | "Convide colegas de equipe para colaborar em chats" | [obs EV-005] |

## Rules
- R-001 (ver rules/onboarding.md)

## Realtime and performance

| Check | Result | Evidence |
|---|---|---|
| Loading pattern | SPA com spinner ao montar | [obs EV-005] |

## Responsive

| Width | Change | Evidence |
|---|---|---|
| 1440 | layout observado | [obs EV-005] |

## Not tested
- Estado vazio (0/4) e completo (4/4); o que marca um passo como concluído.
- Passos 2/3/4 (lifecycle, AI agents, convite) — convite é proibido (A5).
- Teclado/foco/responsivo (390/1024).
- Se o módulo some após concluir.
