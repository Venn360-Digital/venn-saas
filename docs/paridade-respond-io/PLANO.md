# Paridade e plano de implementação — OdontoBox360 × respond.io

Atualizado: 2026-10-26 · Fonte do estudo: `docs/re-respond-io/` (KB congelada, estudo encerrado).
Testes: `scripts/check-paridade.ts` (`npm run check:paridade`).

Este documento aplica a base de conhecimento do respond.io ao OdontoBox360: mapeia
o que **já temos** (não reescrever), marca a paridade regra a regra, e planeja só
as **lacunas**. Clean-room: reproduzimos **comportamento**, nunca textos, ícones,
nomes ou marcas do produto original (regra do `BUILD.md` → "Do not").

A KB cobre 13 regras (R-001..R-013), cada uma com um teste de aceitação
(T-001..T-013). Os testes foram escritos **antes** de qualquer código novo, como
manda o BUILD.md: prova estática de contrato contra o schema e as rotas (o workerd
não roda nesta máquina — ver CLAUDE.md), com guarda de regressão nas regras que já
passam.

---

## 1. Resumo

| | Regras |
|---|---|
| 🟢 **PASS** (paridade atingida) | R-008 |
| 🟡 **PARCIAL** (parte feita) | R-001, R-003, R-006, R-007, R-010, **R-011 (Broadcast — implementado 2026-10-27; falta só a vista Calendário)** |
| 🔴 **GAP** (a construir) | R-002, R-004, R-005, R-009, R-012, R-013 |

> **B2 Broadcast construído** em 2026-10-27 — ver `PLANO-B2-BROADCAST.md` (plano) e
> `DUVIDAS-B2.md` (decisões). Módulo Marketing ativo (Campanhas, Listas, Templates),
> disparo só pelo WhatsApp oficial com template aprovado. Resta a vista Calendário.

O **core loop** do respond.io (canal → inbox → atender/atribuir/fechar → funil →
automação) já existe no OdontoBox360, mapeado ao domínio odontológico. As lacunas
reais são **4 blocos**: Broadcast, Workflow builder visual, ciclo de publicação do
Agente de IA, e alguns ajustes finos de inbox/lifecycle. Dois blocos (Broadcast e
canais) dependem da barreira **BR-001** (WhatsApp via BSP/Meta: templates + pricing
por mensagem) — construir o modelo, **não** disparar sem o canal aprovado.

---

## 2. O que já temos — NÃO reescrever

Mapa das features da KB para o que o OdontoBox360 já implementa. Equivalência de
comportamento, com nomes do nosso domínio.

| Feature (KB) | respond.io | OdontoBox360 — já existe | Onde |
|---|---|---|---|
| F-010/F-014 Inbox unificado + filtros | lista por atribuição, timeline | **Conversas** com abas Em espera/Ativas/Finalizadas + Todas/Minhas | `atendimento/conversas`, `api/conversations/route.ts` |
| F-010 Abrir marca como lida | hidden write + unread count | `lastReadAt` + `unreadCount` | `api/conversations/[id]/read`, `conversations/route.ts:225` |
| F-011 Fechar conversa | status + auto-close | `status active/closed` + cron de auto-close por agente | `cron/conversation-autoclose.ts` |
| F-015 Notas/comentários internos | comment | mensagens `isInternal` | `api/conversations/[id]/notes` |
| F-003 Funil + razões de perda | funil + loss | **Negócios**: `PipelineStage` + `DealOutcomeReason (won/lost)` | `api/pipelines`, `api/deals`, `api/deal-outcome-reasons` |
| F-030/F-032 Agente de IA + ações | AI Agent + AI Skills | **Agentes**: tools de function-calling + motor de regras condição→ação | `trabalhos/servicos/agent-tools.ts`, `lib/rules/executor.ts` |
| F-031 Knowledge sources | PDF/URL/snippet | RAG + knowledge docs | `api/agents/knowledge`, `api/rag/*`, `KnowledgeDocument` |
| F-019 Snippets | respostas prontas | **Respostas rápidas** (atalho `/cmd` + texto) | `respostas-rapidas`, `api/quick-responses`, `QuickResponse` |
| F-007 Tags | tags de contato/conversa | **Etiquetas** | `atendimento/etiquetas`, `Tag`/`ConversationTag`/`ContactTag` |
| F-082 Contatos | details/segments/import | **Pacientes/Contatos** + import/export | `api/contacts/*`, `Contact` |
| F-008 Custom fields | custom fields | definições de campo | `api/custom-fields`, `CustomFieldDefinition`, `AgentCustomField` |
| F-002 Canais WhatsApp/Instagram | conectar canal | WhatsApp (Evolution/QR + Meta Cloud) + Instagram | `api/integrations/meta|instagram`, `webhooks/evolution-go|meta` |
| F-080 Dashboard | supervisão | **Dashboard** (cartão "Operação agora") | `dashboard`, `api/dashboard/summary` |
| F-083 Settings/papéis | users/teams/roles | **Gerenciamento** + papéis + departamentos | `gerenciamento/*`, `WorkspaceUser`, `Department` |

Além disso, o OdontoBox360 tem o que o respond.io **não** tem (domínio odonto):
agenda/especialistas/procedimentos, agendamento pelo agente, crédito por ação de IA,
resposta em áudio. Isso fica fora da paridade — é diferencial próprio.

---

## 3. Tabela de paridade

Veredito por regra, com o teste correspondente e o que falta. Espelha
`npm run check:paridade`.

| Teste | Regra | Área | Status | O que falta para PASS |
|---|---|---|---|---|
| T-001 | R-001 | Onboarding | 🟡 PARCIAL | progresso "N de 4"; passos de lifecycle e convite no fluxo (hoje são 5 passos de provisionamento) |
| T-002 | R-002 | Onboarding | 🔴 GAP | catálogo de canais por categoria (hoje conecta por agente) |
| T-003 | R-003 | Lifecycle | 🟡 PARCIAL | dois **grupos** (funil/perda) e estágio "venda fechada"/padrão (razões won/lost já existem) |
| T-004 | R-004 | Lifecycle | 🔴 GAP | caixa de entrada por estágio (pipeline e inbox desacoplados) |
| T-005 | R-005 | Lifecycle | 🔴 GAP | ocultar estágio sem apagar (soft-hide; hoje só DELETE) |
| T-006 | R-006 | Inbox | 🟡 PARCIAL | "colaborações" / múltiplos atendentes (schema só tem `assignedTo` único) |
| T-007 | R-007 | Inbox | 🟡 PARCIAL | estado `pending` funcional; snooze funcional (auto-close já existe) |
| T-008 | R-008 | Inbox | 🟢 PASS | — |
| T-009 | R-009 | AI Agent | 🔴 GAP | ciclo rascunho→publicar; templates de criação (hoje nasce ativo, só liga/desliga) |
| T-010 | R-010 | AI Agent | 🟡 PARCIAL | skill "atualizar campo"; ação "encerrar"; **modo Teste com mock** |
| T-011 | R-011 | Broadcast | 🟡 PARCIAL | implementado (modelo, fila, fan-out, telas); falta a vista **Calendário** — disparo **gated BR-001** (template Meta) |
| T-012 | R-012 | Workflows | 🔴 GAP | galeria de templates por categoria |
| T-013 | R-013 | Workflows | 🔴 GAP | builder visual (1 gatilho + até 100 steps) + Draft→Publicar |

> O harness não quebra o CI por causa dos GAPs (são backlog). Ele falha só se uma
> regra 🟢/🟡 **regredir** — p.ex. se o `read` parar de gravar `lastReadAt`. Quando
> um GAP for construído, o teste vira PASS sozinho e o harness manda promover a linha.

---

## 4. Plano das lacunas

Ordem por relação valor/esforço e dependências. Clean-room em todos: comportamento
reconstruído, assets e textos próprios.

### Faixa A — ajustes baratos sobre o que já existe

**A1. R-005 — ocultar estágio do funil (soft-hide).** O padrão já existe no próprio
código: `DealOutcomeReason.isActive` faz soft-hide (DELETE desativa em vez de apagar).
Replicar em `PipelineStage`.
- Schema: `PipelineStage` ganha `isActive Boolean @default(true)` (migração não-destrutiva).
- `api/pipelines/[id]/route.ts`: `PATCH` aceita `isActive`; `DELETE` passa a desativar por padrão (apagar de verdade só com confirmação).
- Listagens de funil filtram `isActive` mantendo os negócios intactos.
- Testa T-005.

**A2. R-003 — grupo de perda + estágio de ganho explícitos.** Hoje ganho/perda são
`Deal.status`; falta a **estrutura de estágios** em dois grupos.
- Schema: `PipelineStage` ganha `group String @default("funnel")` (`funnel` | `loss`) e `kind String?` (`default` no primeiro do funil, `won` no de venda fechada).
- Seed (`lib/palette.ts` / `api/pipelines/seed`) cria o grupo de perda e marca o estágio de ganho.
- `api/pipelines/route.ts`: `GET` agrupa por `group`; validação impede mais de um `kind:'won'`.
- Testa T-003.

**A3. R-010 — fechar o conjunto de AI Skills + modo Teste.** O motor de ações já
existe (`lib/rules/executor.ts`); faltam duas ações e o simulador.
- `types/rules.ts`: `ActionType` ganha `update_field` (set de custom field) e `close_conversation`.
- `lib/rules/executor.ts`: implementa as duas (escrever `CustomFieldDefinition`/valor; fechar com `closedAt`).
- **Modo Teste**: endpoint que roda o agente contra um `Contact` mock em memória, sem tocar canal nem persistir — espelha o "não afetará sua configuração" do original. Reusa o pipeline de resposta com um "sink" descartável no lugar do `outbound`.
- Testa T-010.

### Faixa B — lacunas de produto (modelo + UI novos)

**B1. R-009 — ciclo rascunho→publicar do Agente de IA.** Risco real hoje: agente
nasce `isActive:true` e já atende. Tornar a ativação um ato explícito.
- Schema: `Agent` ganha `status String @default("draft")` (`draft` | `published`); `isActive` continua sendo o interruptor operacional **dentro** de publicado.
- `api/agents/route.ts`: criação nasce `draft` (não responde em canal); `api/agents/[id]`: ação `publish`.
- UI `agentes/novo`: botão "Publicar" distinto de "Salvar"; opcional: 2–3 templates de partida (clean-room, nomes próprios: Recepção / Vendas / Suporte) que só pré-preenchem o formulário.
- Runtime (`whatsapp-inbound.ts`): só agentes `published` respondem.
- Testa T-009.

**B2. R-011 — Broadcast.** Módulo inteiro. **Gated por BR-001**: modelar e enfileirar
pode agora; **enviar** só com canal WhatsApp aprovado (BSP/Meta, templates, janela 24h).
- Schema: `Broadcast` (nome interno, rótulos, segmento/filtro, `channelId`, `status` Rascunho→Agendado→Em progresso→Concluído/Falhou, `scheduledAt`, métricas) + itens de destinatário.
- `app/(dashboard)/marketing/campanhas`: listagem com filtros de status + vistas Tabela/Calendário; modal "novo" (nome + rótulos).
- `api/marketing/campaigns/route.ts` (+ `[id]`): CRUD + transições de status.
- Envio: reusa `trabalhos/servicos/outbound.ts` + filas (`cloudflare/agendado.ts`) com ritmo gradual; resolve linha/janela/template como `automations/route.ts:18` já alerta.
- `lib/nav.ts:104`: tira `disabled`/"Em breve". `lib/plans.ts`: gating por plano.
- Testa T-011.

**B3. R-012/R-013 — Workflow builder visual.** Maior esforço. Base atual: `AgentRule`
(1 condição→1 ação, `conditions`/`actions` em Json) — evolui sem migração destrutiva,
mas encadeamento/branch/espera e Draft→Publicar exigem modelo e runtime novos.
- Schema: `Workflow` (trigger + status draft/published + versão) e `WorkflowStep` (tipo, config Json, ordem, arestas/branches). Teto de 100 steps.
- Tipos de step: enviar mensagem, perguntar/coletar, branch condicional, atribuir, atualizar campo/tag/lifecycle, fechar, comentar, esperar/delay, data-hora.
- Runtime: runner com **estado por conversa** e esperas (reusa `cloudflare/agendado.ts` / `agenda-da-conversa.ts`); ponto de entrada onde hoje roda `applyAgentRules` (`whatsapp-inbound.ts:386`).
- UI: canvas (nós + arestas) no lugar da `CondicoesTab`; galeria de templates por categoria (nomes/categorias próprios).
- Testa T-012 e T-013.

### Faixa C — opcionais / decisão de produto

- **R-002** catálogo de canais por categoria: o modelo por-agente é uma escolha válida; só vale se quisermos a tela de onboarding de canal no estilo do original.
- **R-004** inbox automática por estágio do funil: acoplamento forte entre Negócios e Conversas; decidir se queremos isso ou se os dois domínios seguem independentes (hoje funcionam bem separados).
- **R-006** colaborações (múltiplos atendentes por conversa): exige `collaboratorUserIds[]` e revisão do escopo "o atendente só vê o que é dele". Mexe em regra sensível — não fazer sem decisão.
- **R-007** `pending` e snooze funcionais: só se houver demanda; a própria KB deixa a semântica de `pending` em aberto (Q-010).
- **R-001** alinhar o onboarding ao quarteto do original: baixo valor; o nosso fluxo de 5 passos já cumpre a função.

---

## 5. O que não deu para construir a partir da KB

Conforme o BUILD.md ("Report back"): itens em que a KB faltou ou ficou ambígua, com
arquivo e seção.

| Item | Por quê | Arquivo/seção da KB |
|---|---|---|
| Enum real de status de conversa (`pending`?) | SDK público só expõe `open\|close`; `pending`/`snoozed` vistos na UI/API interno mas sem semântica de **quando** aplicar. Fica como decisão aberta. | `data-model/types.ts:29-31`, `api/endpoints.md:78`, `questions.md` Q-010 |
| Config detalhada dos Steps de workflow (Branch/Ask/HTTP/Wait) | Só "Enviar mensagem" foi observado; os demais ficaram "Not tested" — não inventar. | `screens/S-007-workflows.md:48`, `rules/workflow.md` |
| Publicação/ativação de workflow e de broadcast (efeito em canal real) | Não exercitado no estudo (proibido disparar). Comportamento de ativação é inferência. | `screens/S-007:49`, `screens/S-006:46-49` |
| Message limits numéricos do Broadcast por plano/canal | Só "ritmo Gradual" observado; números dependem de BR-001 (pricing Meta). | `screens/S-006:48`, `rules/broadcast.md`, `barriers.md` BR-001 |
| Compositor do Broadcast (segmentação, template, agendamento recorrente) | "Not tested". | `screens/S-006-broadcast.md:46-49` |
| Matriz fina de permissões por papel (flags por papel) | Flags do SDK não todas expostas; "Alterar" não exercitado para não mexer no Owner. | `data-model/permissions.md:23,38`, `questions.md` Q-011 |
| Payload canônico e assinatura (HMAC) dos webhooks | Não público; `event_type` de conversa/contato são inferência. | `api/endpoints.md:59-61` |
| Paginação do API (`{next,previous}` vs `{cursorId,hasMore}`) | Divergência SDK × OpenAPI não resolvida. | `api/endpoints.md:39` |
| Tokens do tema claro / responsivo / teclado | Fora de cobertura no estudo. | `STATUS.md:10,16` |
| Templates individuais de workflow (conteúdo dos ~37) | Só categorias e contagem; conteúdo não capturado. | `rules/workflow.md`, `screens/S-007:50` |

---

## 6. Como rodar os testes

```bash
npm run check:paridade
```

Sem banco e sem rede. Sai 0 quando nada regride (GAPs não quebram o run). Ao
implementar uma lacuna, rode de novo: o teste da regra vira 🟢 e o harness avisa
para promover a linha da tabela acima.

---

## 7. Detalhamento de esforço — B2 (Broadcast) e B3 (Workflow)

Esforço em dias-dev de quem conhece o repo; **exclui** lead externo (aprovação de
template Meta). Evidência do levantamento em `src/trabalhos/servicos/outbound.ts`,
`src/lib/rules/*`, `src/cloudflare/agenda-da-conversa.ts`.

### B2 — Broadcast · tamanho **MÉDIO** · risco arquitetural **BAIXO**, risco operacional **ALTO**

Reusa o canal de WhatsApp que já existe. É uma camada **acima** do envio; o núcleo
não muda. O risco não é código, é Meta/operação.

| Reusa direto | Novo |
|---|---|
| `enqueueOutboundText/Audio` (grava `Message` + enfileira) | models `Broadcast` + `BroadcastRecipient` (idempotência/progresso) |
| processador `processWhatsAppOutbound` (anti-duplo-envio por `externalId`, roteia provedor, mídia por `ref`) | fila `broadcast` separada + serviço de **fan-out** (não usar `whatsapp-outbound` p/ massa → bloqueio de cabeça de fila) |
| provedores evolution-go (QR) e meta-whatsapp (Cloud) | **throttle real** (não existe hoje) |
| resolução de linha (`connectedWhatsApp`, `resolveConversationLine`) | `scheduledAt` absoluto (tabela + varredura por cron; delay da fila é relativo/≤~12h) |
| segmento = filtros de `consultarPacientes` (tag/origem/estado) + opt-out `autoMessagesPausedAt` | rotas `/api/marketing/campaigns` + UI `/marketing/campanhas` (status, Tabela/Calendário, modal) |
| gating `PlanLimits`/`limits.ts`; slot de nav "Campanhas" | **template HSM + janela 24h WhatsApp** (hoje só texto livre) — bloqueador p/ disparo frio no canal oficial |

- **Fatia 1 (~4–6 dias):** model + fan-out + fila + UI lista/criar + envio imediato pelo QR (teste interno). Entrega a maior parte do valor sem depender da Meta.
- **Fatia 2 (~4–7 dias + aprovação Meta):** template HSM + janela 24h + canal oficial + agendamento absoluto + throttle fino.
- **Riscos:** disparo em massa por QR = risco de **ban da linha** do cliente; dedup por destinatário (id estável); fixar `integrationId` por campanha (multi-unidade); mídia por URL/`ref`, nunca inline (teto 128 KB/job).

### B3 — Workflow builder · tamanho **GRANDE** · risco arquitetural **ALTO**

Não é pintar a `CondicoesTab`. É um motor novo com **estado por conversa** — hoje as
regras são *stateless*. A `CondicoesTab`/`AgentRule` cobre ~15–20%: o catálogo de
ações e o ponto de entrada no inbound.

| Capacidade | Base hoje | Veredito |
|---|---|---|
| Catálogo de steps (enviar/transferir/etiquetar/mover) | `executor.ts` (5 ações prontas) | **extensão barata** |
| Ponto de entrada determinístico | `whatsapp-inbound.ts:384` (pré-LLM) | **reusa** |
| Espera/pausa por conversa | DO `AgendaDaConversa` (alarme reagendável) | **extensão** (hoje só 1 payload/debounce; vira máquina de estado) |
| Encadeamento N steps + ponteiro | execução sequencial de `actions[]`, sem continuação | **quase do zero** |
| Branch/ramificação | avaliador é AND-puro | **do zero** |
| Runtime com estado por conversa (stepIndex/variáveis, retomar, correlacionar resposta) | **inexistente** | **do zero — é o coração e o risco** |
| Draft→Publicar + versão | salva direto, sem status/versão | **do zero** (models novos) |
| Canvas nós+arestas | `@dnd-kit` é sortable (kanban), não grafo | **do zero (UI)** — provável **React Flow** (dep nova) |
| Galeria de templates | nada | **do zero** (pequeno) |

- **Não é n8n.** n8n é serviço Node à parte — não encaixa em Workers/Neon nem no modelo por-conversa; seria infra paralela pesada. O motor é **próprio e mínimo**, e o canvas usa React Flow. `@dnd-kit` ajuda pouco (é lista ordenável, não grafo).
- **Custo em ordem:** (1) runtime stateful + espera (coração, incerto — concorrência quando o paciente responde durante a espera, idempotência, teto 100 steps); (2) UI canvas (caro em polish, risco conhecido); (3) modelo + draft/versão (direto, `Json` livre ajuda); (4) catálogo de steps (quase pronto).
- **Esforço:** ~**15–25 dias** (3–5 semanas), o runtime sendo o item de maior incerteza. Recomendável faseado: v1 linear (sem branch/wait) → v2 com espera/branch, para isolar o risco do estado por conversa.
- **Restrição de validação:** o workerd não roda nesta máquina (ver CLAUDE.md), e o estado vive num Durable Object — o runtime precisa ser provado em **staging/CI**, não localmente. Isso pesa mais em B3 que em B2.

### Comparativo e sequência recomendada

| | B2 Broadcast | B3 Workflow |
|---|---|---|
| Tamanho | Médio (~8–13 dias) | Grande (~15–25 dias) |
| Muda arquitetura? | Não (aditivo) | **Sim** (estado por conversa) |
| Reuso do que existe | Alto (canal, filas, envio) | Parcial (ações, entrada, DO) |
| Maior risco | Meta/template + ban do QR | Runtime stateful |
| Dependência externa | BR-001 (template Meta) p/ disparo frio | nenhuma |

**Sequência:** B2 primeiro (fatia 1 entrega valor já, sem Meta); B3 depois e faseado.
Dois ganhos de B2 — **throttle** e **agendamento absoluto** — são primitivas que B3
também vai querer (step "esperar até data"), então fazê-las em B2 adianta B3.
