# S-007 Workflows
Features: F-060..F-068 · URL: `/space/:id/workflows` · `/workflows/templates` · `/workflows/:id` (builder) · Status: draft
Plan: Growth+ (HTTP Request/webhooks Advanced+) [doc SRC-017]

## Purpose
Automatizar processos (auto-resposta, roteamento/atribuição, processos de negócio, supervisão/relatórios) com um construtor visual.

## Entry points
- Nav lateral "workflows". Estado vazio: "Começar do Scratch" ou "Iniciar com um modelo".

## Anatomy

| # | Region | Contents | Evidence |
|---|---|---|---|
| 1 | Lista / estado vazio | "Ainda não tem um workflow"; busca; "Adicionar workflow" | [obs EV-010] |
| 2 | Galeria de templates | categorias + ~37 templates (Use Template) | [obs EV-010] |
| 3 | Builder (canvas) | nó Gatilho + steps encadeados; zoom/undo/redo; Guardar/Teste/Publicar; "Etapas: N/100" | [obs EV-014] |
| 4 | Painel de config (direita) | config do gatilho (condições/variáveis/once) ou do step selecionado | [obs EV-014] |
| 5 | Lista de workflows | colunas Situação/Nome/publicado/Criado/Ações; menu Ações (Publicar/Clonar/Exportar/Apagar) | [obs EV-014] |

## States

| State | How to reach it | What it shows | Evidence |
|---|---|---|---|
| Vazio | 0 workflows | CTA scratch/modelo | [obs EV-010] |
| Galeria | "Iniciar com um modelo" | categorias + templates | [obs EV-010] |
| Builder | scratch/usar template | canvas (não observado) | — |

## Interactions

| Trigger | Result | Request | Persistence scope | Evidence |
|---|---|---|---|---|
| Iniciar com um modelo | abre galeria /workflows/templates | — | — | [obs EV-010] |
| Use Template | cria workflow a partir do modelo (não exercitado) | — | workspace | [obs EV-010] |
| Começar do Scratch | abre builder vazio (não observado) | — | workspace | — |

## Microcopy

| Element | Text | Evidence |
|---|---|---|
| Vazio | "Ainda não tem um workflow — Utilizar fluxos de trabalho para automatizar processos..." | [obs EV-010] |
| Categorias | Auto-Resposta · Roteamento e Atribuição · Processos de Negócio · Supervisão e Relatórios · Meta CTC Ads · TikTok Ads | [obs EV-010] |

## Rules
- R-012, R-013 (ver rules/workflow.md)

## Not tested
- Config detalhada de cada Step além de "Enviar mensagem" (Branch/condições, Ask, HTTP Request, etc.).
- Publicação/ativação de um workflow (não exercitada — ativaria automação em canal real).
- Variáveis dinâmicas; conteúdo individual de cada template.
- Nota: o builder (canvas) **só abre com a aba em primeiro plano** no Claude in Chrome; o modal de criação não aparece em read_page/get_page_text (só em screenshot).
