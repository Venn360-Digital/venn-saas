# 00 — Inventário do OdontoBox360 antes da migração

**Levantado em** 2026-10-21, a partir do repositório na branch `migracao/cloudflare-neon`
e de uma sessão SSH **somente leitura** na VPS de produção.

Cada afirmação carrega uma etiqueta: `VERIFICADO` (medido nesta sessão),
`HIPÓTESE` (inferido do código, não medido) ou `PENDENTE` (não foi possível
confirmar).

---

## 1. Contexto inicial e ferramentas

| Item | Valor | Estado |
| --- | --- | --- |
| Diretório | `/Users/andre/Desktop/Projects/venn-saas` (era `venn.odontobox360` até 14/11/2026) | `VERIFICADO` |
| Remoto oficial | `https://github.com/Venn360-Digital/venn-saas.git` (era `venn360/venn.odontobox360`: renomeado em 14/11, transferido para a organização em 15/11) | `VERIFICADO` |
| Branch no início | `main`, limpa, sincronizada com `origin/main` | `VERIFICADO` |
| Branch de trabalho | `migracao/cloudflare-neon` (criada nesta sessão) | `VERIFICADO` |
| Último commit | `54cb209 fix(avaliação): os avisos de fim de trial ganham escopo de ciclo` | `VERIFICADO` |
| Outras branches | `fase-1-config-do-agente`, `feat/design-system-odontobox360`, `feat/workers-and-selfhost` | `VERIFICADO` |
| Node | v24.11.1 | `VERIFICADO` |
| Gerenciador | **npm** 11.6.2 — `package-lock.json`, `legacy-peer-deps=true` no `.npmrc` | `VERIFICADO` |
| macOS | 12.7.6 (build 21H1320) | `VERIFICADO` |

Não há `wrangler`, nem no projeto nem global — `npx wrangler` tentou baixar
`wrangler@4.151.3` e foi cancelado. Nada foi instalado nesta sessão.

### Trabalho anterior de Cloudflare: não existe

`git log --all` não tem nenhum arquivo `wrangler.*`, `open-next.*` ou `vinext.*`
em nenhuma branch. A branch `feat/workers-and-selfhost`, apesar do nome, é a
preparação do deploy **auto-hospedado** (Docker/Compose) mais o toolkit
`.agent/`. A migração para Cloudflare começa do zero. `VERIFICADO`

### Estado dos MCPs

| Servidor | Estado | Observação |
| --- | --- | --- |
| Neon (`mcp.neon.tech`) | **conectado, funcionando** | leitura e SQL confirmados |
| Cloudflare API — Code Mode (`mcp.cloudflare.com/mcp`) | **falhando** | `whoami` e `execute` retornam erro do conector em todas as tentativas |
| Cloudflare Bindings (MCP antigo, por recurso) | **conectado** | `workers_list` e `r2_buckets_list` responderam |
| Cloudflare Docs | **conectado** | busca na documentação funcionando |
| GitHub MCP | **falhou ao conectar** | `400 Authorization header is badly formatted` |
| Supabase / Vercel / Prisma | **não autorizados** | OAuth pendente; sessão não interativa não consegue autorizar |

Contorno em uso: `gh` CLI autenticado como `venn360`, escopos
`gist, read:org, repo, workflow` — cobre o que o MCP do GitHub faria.
`VERIFICADO`

---

## 2. A aplicação

Next.js **16.1.6**, App Router, React **19.2.3**, TypeScript 5, Tailwind 4.
`output: "standalone"` no `next.config.ts`, porque o Dockerfile copia
`.next/standalone`. `VERIFICADO`

- **407** arquivos `.ts`/`.tsx` em `src/`. `VERIFICADO`
- **107** rotas de API (`src/app/api/**/route.ts`). `VERIFICADO`
- `src/middleware.ts` existe e faz o portão de login. `VERIFICADO`
- Dois redirecionamentos permanentes em `next.config.ts`
  (`/vendas/contatos` → `/vendas/pacientes`, `/vendas/servicos` → `/vendas/procedimentos`).
  `VERIFICADO`

### Processo separado: o worker

`workers/` é um **segundo processo Node**, não um Cloudflare Worker — o nome
colide e vai confundir quem ler depois. Compila com `tsup`, roda com
`node workers/dist/index.js`, e tem 14 processadores de cron mais 8 filas.
`VERIFICADO`

### Dependências relevantes

| Dependência | Versão | Papel |
| --- | --- | --- |
| `@prisma/client` / `prisma` | declarado `^5.10.2`, **resolvido 5.22.0** | ORM, driver padrão (sem driver adapters) |
| `@supabase/supabase-js`, `@supabase/ssr`, `@supabase/auth-helpers-nextjs` | — | auth, storage, realtime |
| `bullmq` + `ioredis` | ^6.3.11 / ^6.0.0 | filas e cron, sobre Redis |
| `openai` | ^6.17.0 | chat, embeddings, TTS, transcrição |
| `langchain` + `@langchain/*` | ^1.x | RAG (splitters, OpenAI, community) |
| `pdf-parse`, `mammoth` | — | extração de texto de PDF/DOCX, só em `agents/knowledge/extract` |
| `bcryptjs` | ^3.0.3 | **declarada mas sem nenhum uso em `src/` ou `workers/`** `VERIFICADO` |

`serverExternalPackages` já tira LangChain, BullMQ e ioredis do bundler.

### Uso de APIs de Node

Praticamente nada: `node:crypto` em 2 arquivos, `node:path` em 1.
Nenhum `fs`, `child_process`, `net` ou `tls` em `src/` ou `workers/`.
`VERIFICADO` — isto é a melhor notícia do inventário para a ida a Workers.

---

## 3. Autenticação

Supabase Auth, pelos três clientes de `src/lib/supabase/`
(`client.ts` navegador, `server.ts` RSC/rotas, `admin.ts` service role) mais
`middleware.ts`. `VERIFICADO`

Superfície medida:

| Chamada | Vezes |
| --- | --- |
| `.auth.getUser` | 87 |
| `.auth.updateUser` | 2 |
| `.auth.signInWithPassword` | 2 |
| `.auth.verifyOtp` | 1 |
| `.auth.signUp` | 1 |
| `.auth.signOut` | 1 |
| `.auth.resetPasswordForEmail` | 1 |
| `.auth.onAuthStateChange` | 1 |
| `.auth.getSession` | 1 |
| `.auth.exchangeCodeForSession` | 1 |
| `.auth.admin` | 1 |

**59 arquivos** tocam `.auth.`. `VERIFICADO`

A autorização por workspace **não** mora no Supabase: mora em
`src/lib/auth/workspace.ts`, sobre o Prisma, com papéis
`OWNER | ADMIN | GESTOR | ATENDENTE` e o cookie `odontobox.workspace`
validado contra o banco a cada pedido. Essa camada **não muda** com a troca de
provedor de identidade — o que muda é só quem responde "quem é esta pessoa".
`VERIFICADO`

Hash de senha: `User.hashedPassword` existe no schema, mas o hash real das
senhas vive em `auth.users` do Supabase (bcrypt do GoTrue). `HIPÓTESE` — não foi
lido nenhum hash, e não se deve.

---

## 4. Banco de dados

Medido na VPS, `2026-10-21`:

| Item | Valor | Estado |
| --- | --- | --- |
| Postgres | **17.6** (self-hosted Supabase) | `VERIFICADO` |
| Tamanho do banco | **19 MB** | `VERIFICADO` |
| Tabelas em `public` | 46 | `VERIFICADO` |
| Usuários em `auth.users` | **3** | `VERIFICADO` |
| Modelos no `schema.prisma` | 45 | `VERIFICADO` |
| Migrations versionadas | 44 | `VERIFICADO` |
| Enums no schema | 0 (papéis e estados são `String`) | `VERIFICADO` |

19 MB e 3 usuários confirmam o que a memória do projeto já dizia: o sistema está
em homologação, não em operação com carga. **A janela de 2 horas não é o
gargalo desta migração** — o gargalo é a reescrita de autenticação, filas e
storage.

### Extensões — e a única que não existe no Neon

Instaladas na VPS: `pg_stat_statements`, `pg_trgm`, `pgcrypto`, `plpgsql`,
**`supabase_vault`**, `unaccent`, `uuid-ossp`, `vector`. `VERIFICADO`

Disponíveis no Neon (consultado em `pg_available_extensions` do projeto real):
`citext 1.8`, `pg_stat_statements 1.12`, `pg_trgm 1.6`, `pgcrypto 1.4`,
`unaccent 1.1`, `uuid-ossp 1.1`, `vector 0.8.6`. `VERIFICADO`

> **`supabase_vault` não existe no Neon, e `pgsodium` também não.**

E ele não é decorativo: `src/lib/vault.ts` lê `vault.decrypted_secrets` e chama
`vault.create_secret` / `vault.update_secret`, e é por ali que passam as
credenciais de plataforma das integrações (`src/lib/platform-credentials.ts`,
`src/lib/asaas/client.ts`). Ver a Fase 2 para a substituição. `VERIFICADO`

### Colunas geradas dependem de uma função própria

A migração `20261010100000_accent_insensitive_search` cria
`public.immutable_unaccent(text)` — um envelope `IMMUTABLE` em volta de
`unaccent`, porque `unaccent` é `STABLE` e coluna gerada exige `IMMUTABLE` — e
usa essa função em colunas `GENERATED ALWAYS AS ... STORED` de várias tabelas.
Restaurar no Neon exige que `unaccent` esteja criada **no schema `public`** e que
essa função exista antes das tabelas. `VERIFICADO`

### pgvector

`KnowledgeChunk.embedding` é `Unsupported("vector(1536)")`, com
`previewFeatures = ["postgresqlExtensions"]` e `extensions = [vector]` no
datasource. O Neon tem `vector 0.8.6`. `VERIFICADO`

---

## 5. Storage

Supabase Storage, um bucket só, nome vindo de `SUPABASE_STORAGE_BUCKET`
(padrão `attachments`). `VERIFICADO`

**Volume real: 5,7 MB** em `compose_supabase_storage_data`. `VERIFICADO`

Apenas **8 pontos de chamada**, o que torna o adaptador barato:

| Arquivo | Operação |
| --- | --- |
| `src/app/api/agents/[id]/avatar/route.ts` | upload de avatar do agente |
| `src/app/api/conversations/[id]/messages/route.ts` | upload de anexo da conversa |
| `workers/src/services/media.ts` | grava mídia recebida do WhatsApp + URL pública |
| `workers/src/services/avatar.ts` | grava avatar + URL pública |
| `workers/src/services/speech.ts` | grava nota de voz gerada + URL pública |

Classificação dos conteúdos (ver Fase 2 para o destino de cada classe):

| Conteúdo | Classe | Destino |
| --- | --- | --- |
| Avatar do agente, prévia de voz | público / não sensível | R2 |
| Mídia recebida e enviada em conversa (foto, áudio, documento de paciente) | **clínico sensível** | provedor com residência no Brasil — **pendente** |
| Nota de voz gerada pelo agente | **sensível** (deriva do conteúdo da conversa) | idem |
| Documento de base de conhecimento | depende do arquivo — classificar no upload | bloqueado até classificar |

O que está hoje no bucket é, em maioria, mídia de conversa. **Nada disso pode ir
para o R2.** `HIPÓTESE` quanto à proporção exata; `VERIFICADO` quanto ao fato de
que é esse o bucket usado pelas três services do worker.

---

## 6. Filas, cron e tempo real

### Oito filas BullMQ sobre Redis

`whatsapp-inbound`, `whatsapp-event`, `whatsapp-outbound`, `ai-reply`,
`rag-index`, `agent-webhook`, `asaas-event`, `cron`. `VERIFICADO`

O contrato vive em `src/lib/queue/definitions.ts` (as rotas enfileiram sem
importar nada de `workers/`), e `workers/` acrescenta a conexão.

### Treze crons

De `workers/src/scheduler.ts`, em `America/Sao_Paulo`: `VERIFICADO`

| Tarefa | Padrão |
| --- | --- |
| `activity-reminders` | `* * * * *` (todo minuto) |
| `daily-briefing` | `2 * * * *` |
| `activity-recurrence` | `7 * * * *` |
| `integration-health` | `*/10 * * * *` |
| `trial-lifecycle` | `17 * * * *` |
| `conversation-autoclose` | `21 * * * *` |
| `auto-follow-up` | `35 * * * *` |
| `instagram-token-refresh` | `48 * * * *` |
| `credits-reset` | `13 3 * * *` |
| `retention` | `41 4 * * *` |
| `billing-dunning` | `27 5 * * *` |
| `billing-reconcile` | `47 5 * * *` |
| `follow-up` | `0 7 * * *` |
| (demais) | ver arquivo |

Os horários são escalonados de propósito, para não concentrar tudo em `:00`.

### Tempo real

Supabase Realtime, em dois usos: `VERIFICADO`

1. `src/app/(dashboard)/atendimento/conversas/page.tsx` — canal
   `conversations-realtime` em mudanças da tabela, com `realtime.setAuth(token)`
   e **polling de 15 s como rede de segurança**;
2. `typing:<conversationId>` — broadcast de "digitando", emitido também por
   `src/app/api/conversations/[id]/typing/route.ts` pelo cliente admin.

---

## 7. Integrações

| Integração | Direção | Rotas | Credencial |
| --- | --- | --- | --- |
| **Google Calendar** | saída + OAuth | `integrations/google/{authorize,callback,calendar}` | OAuth por workspace; `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` |
| **WhatsApp QR (Evolution Go)** | entrada + saída | `webhooks/evolution-go`, `webhooks/evolution` | `EVOLUTION_GO_URL` + `EVOLUTION_GO_API_KEY` |
| **WhatsApp Business (Evolution v2 / Meta Cloud)** | entrada + saída | idem | `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` |
| **Meta (Instagram / Messenger)** | entrada + OAuth | `webhooks/meta`, `integrations/instagram/{authorize,callback}`, `integrations/meta/config` | `META_APP_ID/SECRET`; token de conta renovado por cron |
| **ASAAS** | entrada + saída | `webhooks/asaas` | chave de plataforma, hoje no Vault |
| **Widget de site** | entrada pública | `widget/[key]`, `widget/[key]/messages` | chave por workspace na URL |
| **Webhooks do agente** | saída | fila `agent-webhook` | por agente |
| Meta Ads / Google Ads / Analytics | — | **não existem no código** | `VERIFICADO` |

`src/lib/whatsapp` põe os dois provedores de WhatsApp atrás de uma interface,
selecionada pelo canal da integração (`whatsapp_qr` / `whatsapp_business`).
Baileys não é usado em lugar nenhum. `VERIFICADO`

---

## 8. A VPS hoje

Host `157.254.207.42`, Stay Cloud. Medido `2026-10-21 01:17 UTC`: `VERIFICADO`

| Recurso | Valor |
| --- | --- |
| Uptime | 1 dia 23 h |
| Memória | 5,8 Gi total, 2,4 Gi em uso, 1,0 Gi de swap em uso |
| Disco | 38 G total, **33 G usados, 5,0 G livres (87 %)** |
| Carga | 0,18 / 0,23 / 0,28 |

### Contêineres em execução (16)

`odontobox360-app-1` (healthy), `odontobox360-worker-1` (healthy),
`odontobox360-evolution-go-1` (healthy, `127.0.0.1:8080`),
`odontobox360-evolution-v2-1`, `redis` (healthy), `traefik` (`:80`, `:443`),
`postgres` (healthy — o banco do Evolution), e a pilha Supabase:
`supabase-db`, `supabase-auth`, `supabase-kong`, `supabase-rest`,
`supabase-storage`, `supabase-studio`, `supabase-meta`, `supabase-imgproxy`,
`realtime-dev.supabase-realtime`.

Só `traefik` publica portas para a internet. Tudo o mais é interno; o
`/manager` do Evolution Go e o Studio só por túnel SSH. `VERIFICADO`

### Volumes, por tamanho

| Volume | Tamanho | Conteúdo |
| --- | --- | --- |
| `compose_pg_data` | 257 M | Postgres do Evolution (sessões WhatsApp) |
| `compose_supabase_db_data` | 78 M | **o banco da aplicação** |
| `compose_redis_data` | 30 M | filas BullMQ |
| `compose_supabase_storage_data` | 5,7 M | **os arquivos da aplicação** |
| `compose_supabase_db_config` | 124 K | — |
| `compose_traefik_data` | 60 K | certificados ACME |
| `odontobox360_evolution-v2-instances` | 4,0 K | instâncias Evolution v2 (vazio) |

> **Risco já visível:** 5,0 G livres em disco. Um `pg_dump` do banco de 19 MB
> cabe com folga, mas **o backup não deve ser escrito nesse disco** sem conferir
> antes — e o plano da Fase 3 o traz para a máquina local.

### Dois defeitos conhecidos do Evolution Go

Já registrados e com vigias no host: desliga o número ~105 s depois de parear, e
vaza conexões Postgres até parar de gerar QR em silêncio. Isso é material para a
POC de Containers, não um detalhe: é um componente que **hoje já não mantém
sessão sozinho**. `VERIFICADO` (pela memória do projeto e pelos scripts
`infra/scripts/wa-guard.sh` e `wa-pool-guard.sh`)

---

## 9. Variáveis de ambiente, por NOME

Sem nenhum valor. Presença medida em três arquivos locais — todos cobertos por
`.env*` no `.gitignore`. `VERIFICADO`

### Declaradas em `.env.example` (28)

`AI_HISTORY_LIMIT`, `AI_RAG_CHUNKS`, `CONVERSATION_AUTOCLOSE_HOURS`,
`DATABASE_URL`, `EMAIL_FROM`, `ENABLE_SCHEDULER`, `EVOLUTION_API_KEY`,
`EVOLUTION_API_URL`, `EVOLUTION_GO_API_KEY`, `EVOLUTION_GO_URL`,
`INBOUND_DEBOUNCE_SECONDS`, `LOG_LEVEL`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_DB_SCHEMA`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL`,
`NEXT_PUBLIC_SUPPORT_WHATSAPP`, `OPENAI_API_KEY`, `REDIS_URL`,
`RESEND_API_KEY`, `RETENTION_DELETION_ENABLED`, `SUPABASE_DB_SCHEMA`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `TZ`,
`WEBHOOK_BASE_URL`, `WORKER_QUEUES`

### Presentes em `.env` mas **ausentes** do `.env.example`

`META_APP_ID`, `META_APP_SECRET`, `WEBHOOK_URL`

### Presentes em `.env.local` mas **ausentes** do `.env.example`

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `WEBHOOK_URL`

> **Lacuna:** `WEBHOOK_URL` é usado nos arquivos reais e `WEBHOOK_BASE_URL` é o
> que o exemplo documenta. Um dos dois está errado, e isso precisa ser resolvido
> antes de montar os secrets de produção na Cloudflare. `PENDENTE`

---

## 10. Domínio

`https://odontobox.venn360.com` — subdomínio da zona `venn360.com`. `VERIFICADO`
(encontrado no código; `NEXT_PUBLIC_APP_URL` do `.env.example` é `localhost:3000`
por ser exemplo de desenvolvimento.)

Não foi possível ler a zona pela API da Cloudflare: o MCP de Code Mode está
falhando. Confirmar no painel, antes do corte, o ID da zona, o TTL atual do
registro e se há proxy ligado. `PENDENTE`

---

## 11. Conta Cloudflare

| Item | Estado |
| --- | --- |
| Workers existentes | 2 — `janainaleiteadv`, `advogadamohs` (os sites Astro) `VERIFICADO` |
| Worker do OdontoBox360 | não existe `VERIFICADO` |
| R2 | **habilitado pelo André em 2026-10-21**; zero buckets `VERIFICADO` |
| Workers Paid | contratado (US$ 5/mês) `HIPÓTESE` — informado, não lido pela API |
| Hyperdrive, Queues, Durable Objects, AI Gateway, Email Service | nada provisionado `HIPÓTESE` |

## 12. Conta Neon

| Item | Valor | Estado |
| --- | --- | --- |
| Projeto | `odontobox` — `polished-shape-42069569` | `VERIFICADO` |
| Região | **`aws-sa-east-1` (São Paulo)** | `VERIFICADO` |
| Postgres | **18** | `VERIFICADO` |
| Branch | uma só: `production` (default, primary, **`protected: false`**) | `VERIFICADO` |
| Compute | autoscaling 0,25–2 CU, `suspend_timeout_seconds: 0` | `VERIFICADO` |
| Retenção de histórico | 21 600 s (6 h) | `VERIFICADO` |
| Uso até agora | 0 CPU-s, 0 bytes escritos — projeto vazio | `VERIFICADO` |
| Organização | `org-raspy-feather-39119668` | `VERIFICADO` |

Criado em `2026-10-21T03:54Z`, ou seja: horas antes desta sessão. A região está
certa e o Postgres é mais novo que o da VPS (18 contra 17.6) — a restauração é
no sentido fácil.

---

## 13. Riscos e lacunas

| # | Risco | Gravidade |
| --- | --- | --- |
| 1 | `supabase_vault` não existe no Neon e é dependência real de `src/lib/vault.ts` | **alta** |
| 2 | macOS 12.7.6 não roda `workerd` (exige 13.5+): nenhum build, dev ou deploy de vinext roda nesta máquina — tudo tem de ser no CI | **alta** |
| 3 | 59 arquivos e 87 chamadas `.auth.getUser` para reescrever em Better Auth | **alta** |
| 4 | BullMQ + ioredis + 13 crons: não há Redis em Workers; é reescrita para Queues + Cron Triggers, não porte | **alta** |
| 5 | Mídia de conversa é clínica sensível e o provedor brasileiro ainda não foi escolhido — bloqueia a migração dos arquivos | **alta** |
| 6 | Evolution Go já falha em manter sessão na VPS; em Containers com scale-to-zero é pior | **alta** |
| 7 | Prisma 5.22 sem driver adapters não roda em Workers | média |
| 8 | Disco da VPS a 87 % — cuidado ao escrever dump lá | média |
| 9 | `WEBHOOK_URL` vs `WEBHOOK_BASE_URL` divergem entre código e exemplo | média |
| 10 | Branch `production` do Neon não está protegida | baixa |
| 11 | MCP de Code Mode da Cloudflare falhando; MCP do GitHub não conecta | baixa (há contorno) |
| 12 | `bcryptjs` declarada e sem uso | baixa |
| 13 | A migração `enable_rls` depende de `auth.uid()` e **não roda no Neon** — resolvido, ver `01-compatibility.md` §13 | **resolvido** |
| 14 | Branch protegida no Neon exige plano superior (`HTTP 422` ao tentar) | baixa |
| 15 | `next` com CVE crítico (HTTP request smuggling em rewrites) e `handlebars` crítico via LangChain | média |

## 14. O que não foi possível confirmar

- ID da zona `venn360.com`, TTL e estado de proxy do registro — MCP falhando.
- Se o plano Workers Paid está ativo na conta (informado, não lido).
- Proporção exata entre arquivos públicos e sensíveis no bucket de 5,7 MB.
- Se há senhas em `auth.users` que o Better Auth não consiga verificar — exige
  ler o formato do hash, o que não foi feito.
