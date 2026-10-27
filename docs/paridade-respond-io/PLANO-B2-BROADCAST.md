# Plano de ativação — B2 Broadcast no módulo Marketing

Atualizado: 2026-10-27 · Depende de: `PLANO.md` §4/§7 (levantamento e esforço).
Escopo: ativar **Campanhas** e **Templates** (hoje "Em breve" em `src/lib/nav.ts:104-115`)
e as telas novas necessárias. B3 (Workflow) fica para outra rodada.

## Decisões que fundam o plano (fixas)

1. **Disparo só pelo WhatsApp oficial (Cloud API / canal `whatsapp_business`).** O
   QR (evolution-go) **não** alcança o Broadcast — disparo em massa por QR dá ban da
   linha do cliente. Na escolha da linha, só entram integrações `channel =
   'whatsapp_business'` com `status = 'connected'`; linhas QR aparecem inelegíveis
   com o motivo.
2. **Template é obrigatório na campanha.** Broadcast é mensagem fria (fora da janela
   de 24h), e a Meta só permite isso com **template aprovado (HSM)**. Logo a campanha
   compõe sobre um template aprovado + preenchimento de variáveis — não há texto livre
   em disparo. (Texto livre segue existindo só dentro da conversa, na janela de 24h.)
3. **Listas de contatos são entidade de primeira classe.** A campanha se associa a
   uma ou mais listas; a lista se cria por filtro de pacientes (reusa
   `consultarPacientes`), por seleção manual ou por import. No disparo, a lista é
   **congelada** em destinatários (`BroadcastRecipient`) para dar progresso e
   idempotência.
4. **Fila própria + ritmo.** Fan-out numa fila `broadcast` separada (não na
   `whatsapp-outbound`, para não travar o atendimento), com throttle por linha.
5. **Opt-out respeitado.** Pula `Contact.autoMessagesPausedAt`/`isOptOut`.

## Conexões / infra usadas

| Peça | Origem | Novo? |
|---|---|---|
| Envio oficial | Graph API da Meta via `MetaWhatsAppProvider` (`src/lib/whatsapp/meta-whatsapp.ts`), credenciais em `AgentIntegration.config.business` (`accessToken`/`phoneNumberId`/`businessId`) | reusa; **ganha `sendTemplate`** |
| Templates aprovados | `GET {GRAPH}/{businessId}/message_templates` (WABA) | **novo fetch** |
| Fila/agendamento | Cloudflare Queues via `enfileirar` (`src/trabalhos/filas.ts`); Cron Triggers (`src/cloudflare/agendado.ts`) | **fila `broadcast` nova** + cron de `scheduledAt` |
| Persistência de msg | `Message` + dedup `processed_messages` (padrão do `processWhatsAppOutbound`) | reusa o padrão |
| Segmento | filtros de `consultarPacientes` (`src/lib/pacientes-consulta.ts`) + opt-out | reusa |
| Gating | `PlanLimits`/`src/lib/limits.ts`; nav `src/lib/nav.ts` | estende |
| Banco | Neon (Prisma) | **models novos** |

## Modelo de dados (Prisma — aditivo, sem migração destrutiva)

```
model ContactList {
  id           String  @id @default(cuid())
  workspaceId  String
  name         String
  kind         String  @default("static")   // "static" | "dynamic"
  filter       Json?                          // quando dynamic: filtros de consultarPacientes
  createdAt    DateTime @default(now())
  members      ContactListMember[]
  // @@index([workspaceId])
}
model ContactListMember {
  listId    String
  contactId String
  // @@id([listId, contactId]); relações a ContactList/Contact
}

model WhatsAppTemplate {               // espelho dos templates aprovados na Meta
  id            String @id @default(cuid())
  workspaceId   String
  integrationId String                 // a linha (WABA) de onde veio
  metaName      String                 // nome do template na Meta
  language      String
  category      String                 // MARKETING | UTILITY | AUTHENTICATION
  status        String                 // APPROVED | PENDING | REJECTED
  components    Json                    // header/body/footer/buttons + placeholders
  syncedAt      DateTime @default(now())
  // @@unique([integrationId, metaName, language])
}

model Broadcast {
  id            String   @id @default(cuid())
  workspaceId   String
  name          String                 // interno
  labels        String[]               // rótulos opcionais
  integrationId String                 // linha whatsapp_business (obrigatória)
  templateId    String                 // WhatsAppTemplate (obrigatório)
  variables     Json?                  // mapeamento das variáveis do template
  status        String   @default("draft") // draft|scheduled|running|done|failed|canceled
  scheduledAt   DateTime?
  throttlePerMin Int     @default(30)
  totalCount    Int      @default(0)
  sentCount     Int      @default(0)
  failedCount   Int      @default(0)
  createdAt     DateTime @default(now())
  recipients    BroadcastRecipient[]
}
model BroadcastRecipient {
  id          String  @id @default(cuid())
  broadcastId String
  contactId   String
  to          String                   // MSISDN congelado
  status      String  @default("pending") // pending|sent|delivered|read|failed|skipped
  messageId   String?                  // Message gerada
  error       String?
  // @@index([broadcastId, status]); @@unique([broadcastId, contactId])
}
```

## Telas (módulo Marketing)

Ativar o grupo "Marketing" (`src/lib/nav.ts`): tirar `disabled`/`badge:'Em breve'` de
**Campanhas** e **Templates**, e **adicionar "Listas"** (`/marketing/listas`).

1. **`/marketing/listas`** — CRUD de listas. Criar: (a) por filtro (reaproveita os
   filtros de Pacientes: etiqueta/origem/estado), (b) seleção manual, (c) import CSV
   (reusa `api/contacts/import`). Mostra contagem e prévia; marca opt-outs.
2. **`/marketing/templates`** — lista os templates aprovados, com botão **Sincronizar**
   (puxa da Meta por linha WABA). Só leitura do conteúdo (criar template é no painel da
   Meta — fora de escopo). Badge de categoria/status.
3. **`/marketing/campanhas`** — lista com filtros de status (Todos/Rascunho/Agendado/Em
   progresso/Concluído/Falhou), vistas **Tabela** e **Calendário**, botão "Nova". Linha
   mostra status, linha de envio, enviados/total.
4. **Nova campanha (wizard)** — modal nome + rótulos → **lista(s)** → **linha oficial**
   (só `whatsapp_business` conectadas) + **template** + preenchimento de variáveis →
   revisão (destinatários, custo estimado, ritmo) → Salvar rascunho / Agendar / Enviar.
5. **Detalhe da campanha** — progresso (sent/failed/read), destinatários por status,
   ações Clonar/Cancelar/Excluir.

## Backend / rotas

- `POST|GET /api/marketing/lists` e `/[id]` (CRUD; resolver prévia de filtro).
- `GET /api/marketing/templates` + `POST /api/marketing/templates/sync` (busca na Meta).
- `GET|POST /api/marketing/campaigns` + `/[id]` (CRUD + transições de status + clonar/cancelar).
- `POST /api/marketing/campaigns/[id]/send` (congela destinatários → enfileira fan-out).

## Caminho de envio (o ponto de risco)

1. `send` resolve a(s) lista(s) em `BroadcastRecipient` (aplica opt-out e dedup por
   `[broadcastId, contactId]`), marca `running`, enfileira um job de **fan-out** na fila
   `broadcast`.
2. O fan-out itera destinatários em lotes, respeitando `throttlePerMin` (via
   `atrasoSegundos` escalonado), e para cada um: grava `Message` (status `pending`) e
   chama **`MetaWhatsAppProvider.sendTemplate`** (novo) → `POST {GRAPH}/{phoneNumberId}
   /messages` com `type:'template'`. Idempotente por `BroadcastRecipient` (não reenvia
   quem já tem `messageId`).
3. Recibos (sent/delivered/read/failed) chegam pelo **webhook de status da Meta**
   (`webhooks/meta`) e atualizam `BroadcastRecipient` + contadores.
4. `scheduledAt`: um cron varre `Broadcast` com `scheduled` cuja hora chegou e dispara o
   `send` (o delay relativo da fila não cobre dias).

Extensão no provedor: adicionar `sendTemplate?(creds, to, template)` à interface
`ChannelProvider` (`src/lib/whatsapp/types.ts`), implementada só pelo `meta-whatsapp`
(os demais não disparam broadcast).

## Guarda-corpos de política Meta (não-código)

- Template **aprovado** é pré-requisito do disparo frio; categoria **MARKETING** tem
  preço por mensagem (BR-001). Sem template aprovado, a campanha não sai do rascunho.
- Throughput da WABA tem tiers (a Meta escala conforme qualidade) — `throttlePerMin`
  começa conservador e é configurável.
- Opt-out e frequência: respeitar `autoMessagesPausedAt`; rodapé de descadastro fica
  no próprio template.

## Gating por plano

Adicionar à `PlanLimits` (`src/lib/plan-limits.ts`) um teto de broadcast (ex.:
`maxBroadcastRecipientsPerMonth`) e asserção em `src/lib/limits.ts` no estilo de
`assertCanCreateAgent`. Consumo abate de `maxMessages`/créditos existentes.

## Fases e esforço (dias-dev; exclui aprovação Meta)

| Fase | Entrega | Esforço |
|---|---|---|
| 0 | Nav (tirar "Em breve" + add Listas) + feature flag de plano | 0.5–1 |
| 1 | Models `ContactList`/`Member` + `/api/marketing/lists` + tela Listas | 3–4 |
| 2 | Provider `sendTemplate` + fetch/sync templates + `/api/marketing/templates` + tela Templates | 2–3 |
| 3 | Models `Broadcast`/`Recipient` + fila `broadcast` + fan-out c/ throttle + `/api/marketing/campaigns` + telas lista/novo/detalhe + transições | 4–6 |
| 4 | `scheduledAt` por cron + vista Calendário + recibos (webhook) → métricas | 3–4 |

**Total ~13–18 dias.** Dependência externa: template(s) aprovado(s) na Meta e
confirmação do tier de throughput da WABA (lead da Meta, fora do dev).

## O que NÃO entra

- Canal QR no broadcast (decisão 1). Criar templates pela nossa UI (feito no painel da
  Meta). B3 Workflow. Commerce/pagamento no chat.

## Testes

Estender `scripts/check-paridade.ts`: T-011 vira PASS quando existir `model Broadcast`,
a fila `broadcast` e a rota `/api/marketing/campaigns`. Acrescentar invariantes: "só
linha `whatsapp_business` elegível" e "campanha exige template".
