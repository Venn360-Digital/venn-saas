# S-005 AI Agents
Features: F-004, F-030..F-040 · URL: `/space/:id/ai-agents` · `/ai-agents/templates` · `/ai-agents/:id` · Status: draft
Plan: Growth+ [doc SRC-017]

## Purpose
Criar, configurar, testar e publicar Agentes de IA que atendem conversas automaticamente.

## Entry points
- Nav lateral "ai-agents"; passo 3 do onboarding; link no Inbox "Criar Agente de IA".

## Anatomy

| # | Region | Contents | Evidence |
|---|---|---|---|
| 1 | Landing (0 agentes) | intro + CTA "Comece agora"; link "bases de conhecimento" | [obs EV-008] |
| 2 | Templates | Receptionist, Sales agent, Support agent, Criar do zero | [obs EV-008] |
| 3 | Builder header | nome, badges (Não revisado/Inativo), Cancelar/Guardar/Publicar, barra de progresso | [obs EV-008] |
| 4 | Form: Instruções | prompt + "Adicionar modelos de prompt" + "Otimizar" + "Aprenda a escrever" | [obs EV-008] |
| 5 | Form: Bases de conhecimento | documentos/FAQs/links + "Adicionar" | [obs EV-008] |
| 6 | Form: Habilidades da IA | "Adicionar habilidade" + sugeridas (5) | [obs EV-008] |
| 7 | Painel direito: Teste/Avaliar | simulador de chat + contato mock + upload (≤20MB) + "Redefinir chat" | [obs EV-008] |

## Data shown

| Element | Entity.field | Evidence |
|---|---|---|
| Builder | E-016 (name, instructions, knowledge, skills, status) | [obs EV-008] |
| Contato de teste | E-001 mock (lifecycle, nome, telefone, email, país, idioma, tags) | [obs EV-008] |

## States

| State | How to reach it | What it shows | Evidence |
|---|---|---|---|
| Vazio (0 agentes) | sem agentes | landing com CTA | [obs EV-008] |
| Seleção de template | "Comece agora" | 3 templates + do zero | [obs EV-008] |
| Builder novo | escolher template/do zero | editor "Não revisado / Inativo" | [obs EV-008] |
| Plan-gated | plano sem IA | (não observado; Growth libera) | [doc SRC-017] |

## Interactions

| Trigger | Result | Request | Persistence scope | Evidence |
|---|---|---|---|---|
| "Iniciar do zero" | **cria rascunho** de agente (Inativo) e abre editor | POST (cria agente) | workspace | [obs EV-008] |
| Cancelar | descarta o rascunho (volta a 0 agentes) | — | — | [obs EV-008] |
| Otimizar | IA melhora o prompt (não exercitado) | — | — | [obs EV-008] |
| Teste | simula conversa sem afetar config/canal real | — | — | [obs EV-008] |
| Publicar | ativa o agente (**não exercitado** — ativaria auto-resposta em canal real) | — | workspace | [obs EV-008] |

## Keyboard and accessibility

| Check | Result | Evidence |
|---|---|---|
| Unlabeled controls | vários botões sem rótulo | [obs EV-008] |

## Microcopy

| Element | Text | Evidence |
|---|---|---|
| Instruções | "Descreva a função do Agente de IA, o estilo de comunicação e as habilidades que ele deve desempenhar" | [obs EV-008] |
| Teste | "As habilidades utilizadas aqui são apenas para testes e não afetarão a sua configuração" | [obs EV-008] |

## Rules
- R-009, R-010 (ver rules/ai-agent.md)

## Realtime and performance

| Check | Result | Evidence |
|---|---|---|
| Latência típica do agente | 10–15s declarada | [doc SRC-007] |

## Not tested
- Fluxo completo dos 6 passos até Publicar (não publicar — canal real).
- Config real de Knowledge Sources e cada AI Skill.
- "Otimizar" e simulador de teste em execução.
- Voice AI Agent (F-039), Advanced settings (F-040).
