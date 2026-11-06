# Build brief: respond.io clone

This folder is a reverse engineering knowledge base of respond.io, made with [RES](https://github.com/alextnetto/res) and packed on 2026-10-25. Give it to a coding agent or a team to build a product that behaves the same way. Parts of it may be written in a language other than English.

## Read in this order

1. `STATUS.md`: what the study covered, what it did not, and why.
2. `clone/prd.md`: scope, launch blockers and build order.
3. `clone/barriers.md`: approvals, licenses and certifications to start before or while you build.
4. `data-model/`: `types.ts`, `erd.mmd` and one file per entity.
5. `screens/`, `components/`, `design/tokens.md`: the interface.
6. `rules/` and `clone/parity.md`: the behavior and its acceptance tests.
7. `api/endpoints.md`, `flows/`, `topics/`, `glossary.md`: supporting detail.

## How to build

- Follow the build order in `clone/prd.md`. Start the long approvals in `clone/barriers.md` on day one.
- Write each test in `clone/parity.md` as an automated test before you implement its behavior. A feature is done when its parity tests pass.
- Choose your own stack. `api/endpoints.md` describes the original product: reproduce the data and the behavior, not its URL scheme, unless you need compatibility.
- Statements tagged `[obs]`, `[net]` or `[doc]` are backed by evidence in `evidence/` or `sources.md`. Statements tagged `[inf]` are inferences with an open question in `questions.md`: confirm them with the owner or make them easy to change.
- Every file ends with "Not tested". Do not invent behavior for those items; list them as open.
- Use the screenshots in `evidence/` as a reference for layout and states.

## Stack alvo e ordem de implementação (Next.js + TypeScript + Postgres/Neon + Cloudflare Workers)

Ordem sugerida (detalhe e justificativa em `clone/prd.md` → "Build order"):

1. **Barreiras de lead longo, em paralelo ao dev (dia 1):** iniciar processo de **BSP/Meta Tech Provider** (BR-001 — sem isso não há canal WhatsApp), **DPA/LGPD** (BR-002), **SSO + início de SOC 2** (BR-003), **NFS-e/PSP** para faturar (BR-005/BR-004). São bloqueadores de lançamento no Brasil.
2. **Modelo de dados (Postgres/Neon):** implementar `data-model/types.ts` e `erd.mmd` (entidades E-001..E-016). Atenção: `lifecycleId` é FK; conversa tem `open/pending/close` + `snoozeTill`/`autoCloseTill`; `messageWindowExpiry` (janela 24h WhatsApp).
3. **Backend/API (Cloudflare Workers):** reproduzir o comportamento de `api/endpoints.md` — há um **API interno `/api/v2`** (app) além do público; realtime do Inbox via WebSocket. Webhooks de entrada de canal.
4. **Core loop (Next.js App Router):** Canais → **Inbox** unificado (3 painéis, filtros, timeline) → **Lifecycle** (funil + perda, inbox por etapa).
5. **Regras de `clone/parity.md` como testes** (ver abaixo), P1 primeiro.
6. **IA:** AI Agent (templates, instruções, knowledge sources, AI Skills, modo Teste) + AI Assist. **Workflows** (triggers/steps + biblioteca de templates). **Broadcast**.
7. **Secundários:** Reports, Contacts (segments/import), Settings, Sentiment/CSAT.

Notas da stack (contexto da máquina do André): projetos Next → Cloudflare via **vinext** buildam no CI (Linux); design tokens em `design/tokens.md` já mapeados a CSS variables (equivalente ao "DLS" sobre Vuetify+Tailwind — reimplementar a camada semântica, não copiar).

## Regras como casos de teste

`clone/parity.md` **é** a lista de casos de teste (T-001..T-012), uma linha por regra `R-###`, agrupada por área, com a feature e o status no clone. Escreva cada teste (E2E/integração) **antes** de implementar a feature; a feature está pronta quando seus testes de paridade passam. Regras que dependem de aprofundamento estão marcadas "Not tested" nas telas e não devem ser inventadas.

## Do not

- Copy the original product's code, icons, illustrations, logos, brand names or long texts. Write new copy and draw new assets.
- Use the original product's name or trademarks.
- Ship a feature that `clone/barriers.md` marks as needing an approval or a license before that approval or license is in place.

## Report back

When you finish, list what you could not build from this knowledge base, with the file and section that was missing or unclear.
