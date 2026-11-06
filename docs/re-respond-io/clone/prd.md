# Clone requirements: respond.io
Updated: 2026-10-25 · Status: draft (1ª versão — cobertura P1 das 5 áreas; profundidade parcial, ver STATUS)

## Problem and users
PMEs e agências brasileiras de atendimento/vendas conversacionais (WhatsApp-first) precisam centralizar conversas de múltiplos canais, automatizar respostas e roteamento com IA, e medir atendimento — sem montar infraestrutura própria. Usuários: **agentes** (atendem), **managers** (supervisão/config), **owner** (conta). Stack alvo: Next.js + TypeScript + Postgres/Neon + Cloudflare Workers.

## Launch blockers
De `clone/barriers.md` (blocks launch / adds lead time primeiro):

| Barrier | Severity | Owner | Start by |
|---|---|---|---|
| BR-001 WhatsApp/Meta (ser BSP/Tech Provider ou revender via BSP; verificação; templates; pricing por mensagem) | blocks launch + moat | BizDev/Jurídico | **Mês 1 (lead 2–8 sem)** |
| BR-002 LGPD (DPA PT-BR, DPO, transferência internacional, retenção) | adds lead time → blocks feature | Jurídico | Mês 1 (lead 4–8 sem) |
| BR-003 SSO/SAML + audit logs (+ SOC 2 como moat) | blocks feature (enterprise) | Eng/Segurança | SSO mês 1–2; SOC 2 em paralelo (6–12 meses) |
| BR-005 NF-e/NFS-e (faturar o SaaS) | adds lead time + adds cost | Financeiro/Contador | antes do 1º faturamento |
| BR-004 Pix/PSP (billing e, fase 2, pagamento-no-chat) | adds cost | Financeiro | antes do 1º faturamento |
| BR-006 E-mail/SMS deliverability (SPF/DKIM/DMARC, short code) | adds lead time + adds cost | Eng | antes de usar canais auxiliares |

## Core loop
1. Conectar um canal (WhatsApp-first) → conversas chegam ao **Inbox** unificado.
2. Agente (ou **AI Agent**) atende no Inbox; atribui, comenta, fecha com **closing note**.
3. Contato avança no **Lifecycle** (funil → venda fechada / perda).
4. **Workflows** automatizam auto-resposta, roteamento e processos.
5. **Broadcast** envia campanhas a segmentos; **Reports** medem.

## Scope by priority

| Priority | Feature | Rules | Screens | Notes |
|---|---|---|---|---|
| P1 | Onboarding (conectar canal, lifecycle, AI agent, convidar) | R-001, R-002 | S-002 | convite = A5 (fora do MVP automatizável) |
| P1 | Inbox unificado (lista, chat, filtros, atribuir/fechar, comentários) | R-006, R-007, R-008 | S-003 | status open/pending/close; snooze; auto-close |
| P1 | Lifecycle (funil + perda, inbox por etapa, transitions log) | R-003, R-004, R-005 | S-009 | lifecycleId é FK (E-009) |
| P1 | AI Agent (templates, instruções, knowledge, skills, teste, publicar) | R-009, R-010 | S-005 | Growth+; publicar ativa auto-resposta |
| P1 | Broadcast (status, views, criar/segmentar/agendar) | R-011 | S-006 | Growth+; message limits ligados a BR-001 |
| P1 | Workflows (triggers, steps, templates por categoria) | R-012 | S-007 | Growth+; HTTP/webhooks Advanced+ |
| P2 | Dashboard/Reports, Contacts (segments/import), Settings | — | S-001, S-004, S-008, S-009 | supervisão e config |
| P2/P3 | Sentiment, CSAT, Snippets, Voice AI, Growth Widgets | — | — | diferenciais |

## Non-goals
Marketplace de integrações, billing/cobrança do produto, apps mobile (fora do escopo do estudo). Paridade 1:1 de UI/assets (clean-room: reconstruir do comportamento).

## Data model
Ver `data-model/erd.mmd`, `data-model/types.ts` e `data-model/entities/`. Destaques: **API interno `/api/v2`** (app) além do público; `lifecycleId` FK; conversa com open/pending/close + snooze/auto-close; `messageWindowExpiry` (janela 24h WhatsApp); timeline via `/chat-activity`.

## Build order
1. **Barreiras de lead longo primeiro, em paralelo ao dev:** BR-001 (BSP Meta), BR-002 (LGPD/DPA), BR-003 (SSO + iniciar SOC 2), BR-005 (NFS-e).
2. **Modelo de dados e persistência** (entidades E-001..E-016; Postgres/Neon).
3. **Core loop screens:** Canais → Inbox → Lifecycle.
4. **Regras de `clone/parity.md`, P1 primeiro.**
5. **IA (AI Agent + AI Assist), Workflows, Broadcast** (dependem do canal/BSP).
6. **Secundários:** Reports, Contacts, Settings avançados, Sentiment/CSAT.

## Open questions
Ver `questions.md` (Q-001 segmento, Q-002 termos, Q-003 BSP Meta, Q-006 LGPD, Q-010 enums restantes, Q-011 permissões).
