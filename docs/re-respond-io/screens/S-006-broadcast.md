# S-006 Broadcasts
Features: F-050..F-053 · URL: `/space/:id/broadcast/list` · Status: draft
Plan: Growth+ [doc SRC-017]

## Purpose
Enviar mensagens pontuais a múltiplos contatos (segmentos) por um canal.

## Entry points
- Nav lateral "broadcast".

## Anatomy

| # | Region | Contents | Evidence |
|---|---|---|---|
| 1 | Filtros de status | Todos, Rascunho, Agendado, Em progresso, Concluído, Falhou | [obs EV-009] |
| 2 | Toolbar | Pesquisar, views Tabela/Calendário, "Adicionar Transmissão" | [obs EV-009] |
| 3 | Lista/estado vazio | tabela de broadcasts ou "Você não criou nenhum broadcast" | [obs EV-009] |
| 4 | Modal "Novo broadcast" | Nome (interno) + Rótulos (opcional) → Criar | [obs EV-009] |
| 5 | Drawer de resumo | hora de entrega, segmento, canal, destinatários, total msgs, ritmo (Gradual), enviado por; Apagar/Continuar | [obs EV-015] |
| 6 | Compositor (/broadcast/:id/builder) | wizard: Segmento + Tipo de canal (específico/último) + Canal + Conteúdo → Próximo | [obs EV-015] |

## States

| State | How to reach it | What it shows | Evidence |
|---|---|---|---|
| Vazio | 0 broadcasts | estado vazio + CTA | [obs EV-009] |
| Por status | filtros | Rascunho/Agendado/Em progresso/Concluído/Falhou | [obs EV-009] |

## Interactions

| Trigger | Result | Request | Persistence scope | Evidence |
|---|---|---|---|---|
| Novo broadcast | modal nome+rótulos → compositor | — | workspace | [obs EV-009] |
| Enviar/agendar | **não exercitado (proibido)** | — | — | — |

## Microcopy

| Element | Text | Evidence |
|---|---|---|
| Nome | "Nomeie seu broadcast (visível apenas internamente)" | [obs EV-009] |
| Vazio | "Você não criou nenhum broadcast" | [obs EV-009] |

## Rules
- R-011 (ver rules/broadcast.md)

## Not tested
- Compositor: segmentação de destinatários, canal, template, agendamento único/recorrente.
- Message limits numéricos por plano/canal (ver BR-001).
- Clonar/cancelar/excluir/exportar um broadcast; relatórios (F-054).
- Calendário.
