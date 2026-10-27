# Inventário OdontoBox360 — Fase 01 (somente leitura)

**Data:** 2026-10-27 · **Repo:** `venn.odontobox360` (branch `chore/dup-inventario`) · **Conta Cloudflare:** Venn360 `7ee4810a45580562977d68b86ec709e7`.

Nenhuma escrita foi feita em sistemas da Odontobox. As únicas escritas externas: o projeto Neon temporário `tmp-migration-check` (seção E). Nenhum valor de segredo aparece aqui — só nomes.

---

## A. Código

### A1 — Stack e versões
- **Next.js 16.4.2**, React 19.3.1, build para Cloudflare via **vinext 1.3.0 + `@vinext/cloudflare` 1.2.0** (não `@opennextjs/cloudflare`). Config do Worker declarativa em `cloudflare.config.ts` via `cf/config` (`cf` 1.0.0-beta.20) — **não há `wrangler.jsonc`/`.toml`**.
- **Prisma 6.19.3** com gerador novo (`prisma-client`), dois clientes por `imports` do `package.json`: `#prisma` → `src/generated/prisma-workerd` (runtime workerd) ou `src/generated/prisma` (node). Adaptadores `@prisma/adapter-neon` e `@prisma/adapter-pg`; driver `@neondatabase/serverless` 1.2.0 e `pg` 8.16.3.
- **Postgres 18** (Neon). Extensões: `vector` 0.8.6 (pgvector/RAG), `pg_trgm` 1.6, `unaccent` 1.1, `plpgsql`.
- **Better Auth 1.7.12**. **BullMQ 6 + ioredis 6** (processo legado de filas; no Worker as filas são Cloudflare Queues). OpenAI 6 + LangChain 1 (RAG). `aws4fetch` 1.0.20 (R2 via S3).
- compatibilityDate `2026-10-21`, flags `nodejs_compat`. Node 24 no CI.

### A2 — Configuração do Worker (`cloudflare.config.ts`)
**Ambiente único.** Não há `env.stg`/`env.production` no arquivo; o mesmo config serve produção e preview, com preview distinguido por `process.env.CF_PREVIEW === '1'` (suprime `triggers`). → Ver achado de paridade (H).

| Item | Valor |
|---|---|
| `name` | `odontobox` |
| rotas / custom domain | custom domain `odontobox.venn360.com` (ativo na conta; não há `routes` no script) |
| `workersDev` | `false` · `previewUrls` `true` |
| Durable Objects (sqlite) | `SalaDoWorkspace`, `AgendaDaConversa`, `TravaDeContato` |
| Filas (produtor) | `odontobox-{whatsapp-inbound,whatsapp-event,whatsapp-outbound,ai-reply,rag-index,agent-webhook,asaas-event,broadcast,cron}` (9) |
| R2 | binding `PUBLICO` → `odontobox-public`; `odontobox-private` usado via S3 (sem binding) |
| Email | `EMAIL` = `bindings.sendEmail()`; `EMAIL_FROM` = `OdontoBox360 <noreply@mail.venn360.com>` |
| Text vars | `TZ=America/Sao_Paulo`, `LOG_LEVEL=info`, `PUBLIC_STORAGE_BUCKET=odontobox-public`, `PRIVATE_STORAGE_BUCKET=odontobox-private`, `PUBLIC/PRIVATE_STORAGE_REGION=auto` |
| Crons | 13 declarados (gerados de `cronsParaWrangler()`, em UTC) — **12 ativos na conta** (divergência, ver C4) |
| AI / Analytics Engine / Workflows / Services / Secrets Store / D1 / KV / Hyperdrive | **nenhum** |

Segredos declarados (só nomes): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `OPENAI_API_KEY`, `EVOLUTION_GO_URL`, `EVOLUTION_GO_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `WEBHOOK_BASE_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `PLATFORM_ASAAS_CLIENT_ID`, `PLATFORM_ASAAS_CLIENT_SECRET`, `PLATFORM_GOOGLE_CALENDAR_CLIENT_ID`, `PLATFORM_GOOGLE_CALENDAR_CLIENT_SECRET`, `PUBLIC_STORAGE_{ENDPOINT,ACCESS_KEY_ID,SECRET_ACCESS_KEY}`, `PRIVATE_STORAGE_{ENDPOINT,ACCESS_KEY_ID,SECRET_ACCESS_KEY}`.

### A3 — Variáveis de ambiente
Produção **não lê `.env`**: os valores vivem em Cloudflare Secrets / text bindings; `nodejs_compat` popula `process.env` a partir deles (`src/trabalhos/ambiente.ts`, um Proxy validado por zod; não há `getCloudflareContext`). Não existem `.dev.vars*`.

Secretos (nomes): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `OPENAI_API_KEY`, `EVOLUTION_GO_URL`, `EVOLUTION_GO_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `WEBHOOK_BASE_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `PLATFORM_ASAAS_CLIENT_ID/SECRET`, `PLATFORM_GOOGLE_CALENDAR_CLIENT_ID/SECRET`, `PLATFORM_META_MESSAGING_CLIENT_ID/SECRET/VERIFY_TOKEN`, `PLATFORM_INSTAGRAM_LOGIN_CLIENT_ID/SECRET`, `PUBLIC/PRIVATE_STORAGE_{ENDPOINT,ACCESS_KEY_ID,SECRET_ACCESS_KEY}`.
Vars públicas: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPPORT_WHATSAPP`, `NEXT_PUBLIC_SUPPORT_EMAIL`.
Vars de servidor (não-secreto): `META_APP_ID`, `INSTAGRAM_APP_ID` (IDs públicos), `DB_SCHEMA`, `LOG_LEVEL`, `TZ`, `NODE_ENV`, `DEBUG`, `PUBLIC/PRIVATE_STORAGE_{BUCKET,REGION}`, `PUBLIC_STORAGE_BASE_URL`, `INBOUND_DEBOUNCE_SECONDS`, `AI_RAG_CHUNKS`, `AI_RAG_MIN_SIMILARITY`, `AI_HISTORY_LIMIT`, `AGENT_SPEECH_MAX_CHARS`, `CONVERSATION_AUTOCLOSE_HOURS`, `RECURRENCE_HORIZON_DAYS`, `RETENTION_DELETION_ENABLED`, `EVOLUTION_GO_RECYCLE_AFTER_PAIR`.
Legado (no `.env.example`/`compose`, não lido por `src/`): `REDIS_URL`, `WORKER_QUEUES`, `ENABLE_SCHEDULER`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `WEBHOOK_URL`.

### A4 — Better Auth (`src/lib/auth/better-auth.ts`)
- **Só e-mail/senha.** `requireEmailVerification: false` (cadastro aberto p/ homologação), `minPasswordLength: 8`, reset por Cloudflare Email Sending. **Sem Google / magic link / OAuth / OTP / passkey. Zero plugins** (sem `organization`/`admin`/`2FA`) — multi-tenant é feito à mão via `WorkspaceUser`.
- `baseURL` dinâmico `{ allowedHosts: HOSTS_PERMITIDOS, fallback: 'https://odontobox.venn360.com' }`; `HOSTS_PERMITIDOS` = `odontobox.venn360.com`, `*.andre-7ee.workers.dev`, e (fora de prod) `localhost:*`/`127.0.0.1:*`. `trustedOrigins` derivado daí.
- `advanced`: só `database.generateId:false`. **`cookiePrefix`, `crossSubDomainCookies` e `useSecureCookies` NÃO setados** (defaults da lib) → ver nota T5 no relatório.
- `secret` = `BETTER_AUTH_SECRET`. Sessão 8h (`AuthSession`), rate-limit **em banco** (`AuthRateLimit`). Tabelas: `users`, `auth_sessions`, `auth_accounts` (único hash de senha), `auth_verifications`, `auth_rate_limits`.
- Autorização de rota: `src/lib/auth/workspace.ts` (escopa por `workspaceId`; cookie de unidade `odontobox.workspace`).

### A5 — Migrations
Prisma, pasta `prisma/migrations/`, **48 migrations**, `migration_lock.toml` provider `postgresql`. **Sem `db push`** (só `prisma migrate deploy`). **Sem seeds** (`prisma/seed*` inexistente). Sem SQL fora das migrations. Reprodutibilidade: **IDÊNTICO** (ver `schema-diff.md`). Primeira: `20260101000000_baseline`; última: `20261027000000_marketing_broadcast`. Scripts `tsx` de verificação em `package.json` (`check:*`) e `migrar-usuarios.ts` (migração de usuários do provedor antigo, não é seed).

### A6 — Integrações no código
Hosts externos (todos por `fetch`/SDK): `graph.facebook.com/v23.0` (WhatsApp Cloud oficial + onboarding), `graph.instagram.com/v25.0` + `api.instagram.com` + `www.instagram.com` (Instagram Direct/OAuth), `accounts.google.com`/`oauth2.googleapis.com`/`www.googleapis.com/calendar/v3` (Google Calendar), `api.asaas.com/v3` e `api-sandbox.asaas.com/v3` (cobrança), `api.openai.com` (chat, transcribe, TTS, embeddings), `viacep.com.br` (CEP), Evolution Go (host dinâmico), R2/S3 (host dinâmico).
Webhooks recebidos:
| Path | Método | Origem | Assinatura |
|---|---|---|---|
| `/api/webhooks/meta` | GET/POST | Meta (WhatsApp Cloud + Instagram) | GET: `hub.verify_token`; POST: HMAC `x-hub-signature-256` (2 chaves), tempo constante |
| `/api/webhooks/asaas` | POST | Asaas | header `asaas-access-token`, tempo constante, dedup por `asaasEventId` |
| `/api/webhooks/evolution-go/[secret]` | POST | Evolution Go (VPS) | **segredo no path** (`EVOLUTION_WEBHOOK_SECRET`), tempo constante |
E-mail: **Cloudflare Email Sending** por binding registrado (`registrarRemetenteDeEmail`/`sendEmail` em `src/lib/email/send.ts`), remetente `noreply@mail.venn360.com`, `Reply-To: contato@venn360.com`. **Resend/SendGrid/Nodemailer/Stripe removidos** (só comentário histórico).

### A7 — WhatsApp QR / Evolution
Cliente: **Evolution Go (whatsmeow)** — `src/lib/whatsapp/evolution-go.ts` (`EvolutionGoProvider`). Evolution API v2 (Node) **aposentado**; o canal oficial fala direto na Graph. Mapa: `whatsapp_qr`→`evolution-go`, `whatsapp_business`→`meta-whatsapp`, `instagram`→`meta-instagram`.
Endpoints chamados: `/instance/{create,connect,qr,status,all,disconnect,delete}`, `/user/{check,avatar}`, `/send/{text,media}`, `/message/{react,markread,presence,downloadmedia}`, `/server/ok`. Auth: header `apikey` (chave global ou token por instância).
Eventos tratados (whatsmeow): `Message`, `SendMessage`, `Receipt`, `Connected`/`PairSuccess`, `LoggedOut`, `QRCode`/`QRTimeout`, `ChatPresence`/`Presence`, `Picture`. URL/chave via `EVOLUTION_GO_URL` / `EVOLUTION_GO_API_KEY`; dentro do Worker por service binding `gateway`; caminho público usa Access (`CF-Access-Client-Id/Secret`). Webhook montado por `webhookUrlFor` (`WEBHOOK_BASE_URL`).

### A8 — R2 / Storage
Acesso via **API S3 (`aws4fetch`)**, não binding nativo. URLs **presigned** (validade máx. 600s, nunca persistidas). Chave sempre começa por `workspaceId` (`chaveDe`, recusa `..`/`/`). Classes: `PUBLICO` (`r2-publico` → `odontobox-public`, servido por `PUBLIC_STORAGE_BASE_URL` quando há custom domain), `CLINICO` (`r2-privado` → `odontobox-private`, só URL assinada), `NAO_CLASSIFICADO` (bloqueia gravação). Sem `r2.dev`. Nota: buckets em `ENAM` (não há região R2 na América do Sul); cifra-na-aplicação para clínico é **pendência não implementada**.

### A9 — Identidade hardcoded (resumo; detalhe por `arquivo:linha` no anexo de varredura)
- **Nome/metadados:** `src/app/layout.tsx` (`title: 'OdontoBox360'`, descrição “…clínicas odontológicas”), `DocumentTitle.tsx`, `package.json` (`venn.odontobox360`). **Sem manifest PWA, sem bloco `icons`/`openGraph`/og-image.**
- **Logos/ícones:** `src/components/brand/Logo.tsx` + `public/logos/*.png` (7), `src/app/favicon.ico`, `public/planos/*.png` (6), brand kit em `docs/brand/`.
- **Cores:** `src/app/globals.css` (navy `#0B1F3B`, teal `#06B6D4`, mint `#A7F3D0`, ice `#E6F7F5`), `Specialist.color` default `#06B6D4`.
- **Domínios:** `odontobox.venn360.com` (better-auth, e-mails, templates em `public/email/*.html`), `suporte.odontobox.venn360.com`, default slug `app.odontobox360.com.br` (onboarding), `evo-odontobox.venn360.com`.
- **E-mails:** `contato@venn360.com`, `privacidade@venn360.com`, remetente `noreply@mail.venn360.com`.
- **Legais:** `src/app/privacidade/page.tsx` (operador LGPD). **Sem página de Termos** (há só o modelo `TermsAcceptance`).
- **localStorage/instância:** `odontobox360-*`, `odontobox.inbox.*`, nome de instância Meta `odontobox_${workspaceId}_${phoneNumberId}`.

### A10 — Segmento odontológico
**O núcleo é um CRM/atendimento multicanal genérico.** Não há módulo clínico real (sem odontograma, dente, anamnese, CRO, prontuário, convênio como entidade). A “odontologia” é de superfície: rótulos de rota (`vendas/pacientes` = Contact, `vendas/especialistas` = Specialist, `vendas/procedimentos` = ProductService), setor hardcoded `SETOR_PADRAO = 'Clínica odontológica'` (`TrabalhoTab.tsx`, `useAgentCreation.ts`), cor teal default, e textos de exemplo do agente (“convênios”, “ortodontia”). Migrar de segmento = renomear rótulos + soltar o setor fixo; não há módulo a remover.

### A11 — CI/CD (`.github/workflows/`, Node 24)
- **`deploy.yml`** (push `main`): job `verificar` (typecheck/lint/`build`/`build:vinext`) + job `publicar` (environment `production` com revisor obrigatório; `deploy:vinext`). Migração **não** roda aqui. Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **`checks.yml`** (PR + push em `migracao/cloudflare-neon`): job `estatico` + job `banco` que cria **branch efêmera Neon** por execução (projeto `polished-shape-42069569` hardcoded), roda `migrate deploy` + checks, apaga a branch no `always()`. Secret: `NEON_API_KEY`.
- **`migrate.yml`** (`workflow_dispatch` manual): `migrate deploy` no ambiente escolhido, com tranca de confirmação textual e de host (`DB_HOST_ESPERADO`). Secret: `DATABASE_URL_DIRECT`.
- **`preview.yml`** (PR): publica preview Cloudflare (`CF_PREVIEW=1`), comenta URL; job de limpeza no close. Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Sem Workers Builds** (deploy por `cf`/`vinext-cloudflare` dentro do Actions). Secrets GitHub (nomes): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY`, `DATABASE_URL_DIRECT`; var `DB_HOST_ESPERADO`.

---

## B. Histórico Git
`gitleaks` 8.30.1, `detect --log-opts="--all"` (630 commits, 19.9 MB). **6 achados, todos falsos positivos**, nenhum com credencial viva:

| # | regra | arquivo:linha | commit | data | classificação |
|---|---|---|---|---|---|
| 1 | generic-api-key | `scripts/check-auth.ts:261` | 34585e72 | 2026-10-21 | token de teste (prova de reset) |
| 2–4 | generic-api-key | `scripts/check-auth.ts:140,174,181` | ba488e19 | 2026-10-21 | literais de teste (`password: senha`, regex `HttpOnly`) |
| 5 | generic-api-key | `scripts/check-auth.ts:95` | 94aad230 | 2026-10-21 | path de teste `/atendimento/agentes/integracoes` |
| 6 | generic-api-key | `src/hooks/useSoundEnabled.ts:5` | 4a989b9c | 2026-10-08 | chave de `localStorage` `odontobox360-sound-enabled` |

Nenhuma credencial do item A3 aparece no histórico (o `.env` é git-ignored e nunca foi commitado). Nada a rotacionar antes do espelhamento.

---

## C. Cloudflare (leitura)

### C1 — Conta e zonas
Conta **Venn360** `7ee4810a45580562977d68b86ec709e7` (única). Zonas (todas **Free**, status active): `venn360.com`, `advogadamohs.com.br`, `autoshopbh.com.br`, `avantempresarial.com`, `implantejabh.com.br`, `janainaleiteadv.com.br`, `kaly.app`, `sorrianovamentemg.com.br`, `visuallawdigital.com`.
**`stagent.com.br` e `conecta.com.br` NÃO existem** (e nunca existiram — decisão do André 2026-10-27: os novos sistemas são subdomínios de `venn360.com`). Não há zona dedicada “odontobox”; o app vive sob `venn360.com`.

### C2 — Plano e limites
Free em todas. Rulesets custom na zona `venn360.com`: 1 rate-limit (`limite-de-taxa`), 1 WAF custom (`regras-proprias`, 2 regras), 1 redirect (`default`). Managed ativos: Normalization, Managed Response Firewall, **Cloudflare Managed Free Ruleset**, DDoS L7. Folga para novas regras.

### C3 — SSL/TLS
(Não alterado.) Universal SSL cobre `*.venn360.com` (um nível). `homolog.{slug}.venn360.com` (dois níveis) dependerá do certificado por-hostname do Custom Domain de Worker — confirmar status `active` na Fase 10.

### C4 — Worker `odontobox`
Tag `ed8d57aacf3242e29355327da2829eaf`; handlers `fetch`/`queue`/`scheduled`; DO `AgendaDaConversa`/`SalaDoWorkspace`/`TravaDeContato` (sqlite). compat `2026-10-21` + `nodejs_compat`. `subdomain.enabled=false` (workers.dev off), `previews_enabled=true`. **Custom domain `odontobox.venn360.com` ativo** (cert `d0cf09c7…`). Deploys por `cf_cli`/`wrangler` (não Workers Builds); último 2026-10-27. Bindings reais confirmam A2.
- **Segredo órfão `RESEND_API_KEY`** presente no Worker mas **não declarado** no `cloudflare.config.ts` (Resend desativado) → limpar na Fase 02 e retirar no Resend.
- **12 cron triggers ativos** vs **13 declarados** no código → divergência a conferir.
- DO namespace ids: `AgendaDaConversa` `0e4fcb95bc6e45e282d0a72bb74a5bc7`, `SalaDoWorkspace` `f09c1361c214423c815f4efedbea74be`, `TravaDeContato` `dad5c7bfca3a4c9cacf692be27b04885`.

### C5 — Armazenamento e filas
- **Filas:** 9 principais `odontobox-*` + 9 DLQ (retenção 4 dias). **Produtores incluem `pr-10`…`pr-18`** (Workers de preview) → previews **produzem nas filas de produção** (consumidores só `odontobox`, pois `CF_PREVIEW` suprime triggers). Achado de isolamento.
- **R2:** `odontobox-public`, `odontobox-private` (+ `visuallaw-iscas` de outro app). Sem Hyperdrive. **KV:** só `venn360-vinext-cache` (do Worker `venn360`, não do odontobox). **D1/Secrets Store:** nenhum.
- **Durable Objects:** 3 (acima).

### C6 — Access
App `evolution-go` (`2e5772ad-ba25-400f-b26c-047698638072`, aud `add2d7916c…`), domínio `evo-odontobox.venn360.com`, política **Service Auth** (`non_identity`) via service token. Service token: **`odontobox-worker`** (`a0f7469a-d1a9-4cc5-89a9-2240c5e61a13`, client_id `892e1e51…access`, expira 2126, sessão 24h).

### C7 — WAF / rate limit / redirects (zona `venn360.com`)
- `limite-de-taxa` (rate limit): POST `/api/auth/*` → 20/10s por `ip.src`+`cf.colo.id`, block. **Por path, não por hostname** → atinge toda a zona.
- `regras-proprias` (WAF custom): (1) bloqueia sondagem `/.env`,`/.git`,`/wp-*`,`/phpmyadmin`… ; (2) `/api/webhooks/evolution-go/` só do IP da VPS `216.238.127.233` + `2001:19f0:b800:2539::/64` (senão block). Por path, não por hostname.
- `default` (redirect): `www.venn360.com` → apex.

### C8 — Turnstile
**Nenhum widget.** (O “site widget” do produto é outra coisa; não há CAPTCHA/Turnstile.)

### C9 — E-mail
- **Email Routing** em `venn360.com`: `unconfigured`/desabilitado (1 regra drop-all desativada). Destino verificado na conta: só `contato@janainaleiteadv.com.br` (outro app).
- **Email Sending** no subdomínio `mail.venn360.com`: DKIM `cf-bounce._domainkey.mail.venn360.com`, SPF `cf-bounce.mail` (`include:_spf.mx.cloudflare.net`), DMARC `_dmarc.mail.venn360.com` `p=reject`, MX `cf-bounce.mail` → `route{1,2,3}.mx.cloudflare.net`.
- **Apex `venn360.com`:** MX `smtp.google.com` (Google Workspace), SPF `include:_spf.google.com ~all`, DKIM `google._domainkey`, **DMARC `_dmarc.venn360.com` `p=quarantine` SEM `sp=`** → subdomínios novos herdam `quarantine`. Verificações: `facebook-domain-verification`, `google-site-verification`.

### C10 — DNS (hosts da Odontobox)
- `odontobox.venn360.com` → AAAA `100::` **proxied** (custom domain do Worker).
- `evo-odontobox.venn360.com` → CNAME `8d90f2b1-c880-4a4b-a0e5-5b636219f3bd.cfargotunnel.com` **proxied** (Tunnel).
- `mail.venn360.com` (+`cf-bounce`): registros de Email Sending acima.

---

## D. Neon (leitura)

### D1 — Projeto
`odontobox` (**`polished-shape-42069569`**), org `org-raspy-feather-39119668`, região `aws-sa-east-1`, **PG 18**, autoscale **0.25–2 CU**, `suspend_timeout=0`, **retenção/PITR 6h** (21600s). Sem branches protegidas.

### D2 — Branches e endpoints
| Branch | Papel | Pai | Endpoint | Estado |
|---|---|---|---|---|
| `br-weathered-water-b6wu2by1` | **production** (primary/default) | — | `ep-icy-mode-b6mp2z8h` (0.25–2 CU) | ativo — **não suspende** (cron ≤5min o mantém) |
| `br-bold-violet-b6phz4yu` | **staging** | production (LSN `0/1BD2EE8`) | `ep-lucky-pond-b6n42j1j` | suspende (suspendeu 2026-10-26) |

Nenhuma branch protegida. `passwordless_access: true` nos dois. **`.env` local aponta para o endpoint de staging** (`ep-lucky-pond`), não produção.

### D3 — Databases, roles, extensões, tabelas
- Databases: `neondb` (app), `postgres`.
- Roles (sem `pg_*`): `cloud_admin` (super), `neon_superuser`, `neon_service`, `neon_auth`, `neondb_owner` (owner/login do app), `token_roles`. **Não há separação `_migrator`/`_app` nem role read-only** (o app usa `neondb_owner`).
- Extensões: `pg_trgm` 1.6, `unaccent` 1.1, `vector` 0.8.6, `plpgsql` 1.0.
- Schemas/tabelas: `public` **59 tabelas** (581 colunas, 516 constraints, 182 índices); **`neon_auth` 9 tabelas** = provisionamento do **Neon Auth (Managed Better Auth)** `account/invitation/jwks/member/organization/project_config/session/user/verification` — **não usado** pelo app (que tem Better Auth próprio em `public`). Resíduo a limpar.

### D4 — Schema de produção
`infra/inventory/odontobox-schema-prod.sql` (DDL, 1544 linhas, 58 tabelas + `_prisma_migrations`). Gerado via `prisma migrate diff` do projeto temporário (estrutura provada idêntica a produção), sem manipular credencial de produção. Observação: não existe role read-only em produção (o runbook pede uma); registrar como pendência (D3).

### E — ver `schema-diff.md`. Veredito **IDÊNTICO**.

---

## F. VPS Vultr (SSH leitura + MCP Vultr)

### F1 — Instância
**`odontobox`** (`c7e5d07a-e0dc-42ef-9323-eb6e33c28683`), Ubuntu 26.04.1 LTS, plano `vhf-2c-4gb` (**2 vCPU / 4 GB / 128 GB NVMe**), região `sao` (São Paulo), IP `216.238.127.233` (+ IPv6 `2001:19f0:b800:2539::/64`), running, tags `Odontobox360`. **Sem firewall group Vultr** (`firewall_group_id` vazio). **Backups automáticos DESABILITADOS. Nenhum snapshot.** → dedicada só ao Evolution (VPS reformatada em 2026-10-23).

### F2 — Sistema
Docker 29.9.2, Compose v5.6.1. `free -h`: 3.3 GiB total, ~806 MiB usados, **2.5 GiB livres**, swap 8 GiB (0 em uso). Disco `/`: 120 G, **14 G usados (12%)**, 102 G livres. Uptime 3 dias, load ~0.03. UFW **ativo** (só `22/tcp` de Anywhere). Portas públicas: **só SSH 22**; `8080` só em `127.0.0.1` (docker-proxy); nada mais exposto (Tunnel é saída).

### F3/F4 — Containers (compose project `odontobox-evolution`, arquivo `/opt/evolution/compose.yaml`)
| Container | Imagem | Estado | Portas | Mem | Restart | Limite |
|---|---|---|---|---|---|---|
| `odontobox-evolution-evolution-go-1` | `evoapicloud/evolution-go:0.7.2` | Up 3d (healthy) | `127.0.0.1:8080` | 27.7 MiB | always | 512 MiB |
| `odontobox-evolution-postgres-1` | `postgres:16-alpine` | Up 3d (healthy) | 5432 (interno) | 90 MiB | always | — |
| `odontobox-evolution-cloudflared-1` | `cloudflare/cloudflared:2026.8.1` | Up 3d | — | 16 MiB | always | — |
| `odontobox-evolution-evolution-go-db-init-1` | `postgres:16-alpine` | Exited (0) | — | — | no | — |
Redes: `odontobox-evolution_evo` (bridge). Volumes: `odontobox-evolution_evo-postgres` + 1 anônimo. Env do evolution-go (nomes): `SERVER_PORT`, `CLIENT_NAME`, `GLOBAL_API_KEY`, `POSTGRES_AUTH_DB`, `POSTGRES_USERS_DB`, `DATABASE_SAVE_MESSAGES`, `WEBHOOKFILES`, `MINIO_ENABLED`, `CONNECT_ON_STARTUP`, `WADEBUG`, `LOGTYPE`, `TZ`.
**Evolution:** só **Evolution Go 0.7.2** (sem v2 Node). Hostname público `evo-odontobox.venn360.com` (Tunnel `8d90f2b1…`). Bancos `evogo_auth`/`evogo_users` no Postgres local. **Sem Redis** (Evolution Go usa Postgres). Webhook de saída → `odontobox.venn360.com/api/webhooks/evolution-go/<secret>`. **1 instância ativa, 1 número pareado** (`whatsmeow_device`). Tráfego real: **3298 linhas de log em 24h**.

### F5 — Reverse proxy
**Não há Caddy/Traefik/Nginx.** A única entrada é o **Cloudflare Tunnel** (`cloudflared`), sem porta 443/80 na VPS; origem atrás do proxy da Cloudflare. Endurecida com Access Service Auth em `evo-odontobox.venn360.com`.

### F6 — Postgres/Redis da VPS
Postgres `postgres:16-alpine` (só do Evolution, não exposto). Databases `evogo_auth`, `evogo_users`, `postgres`. Role: só `postgres` (superuser). **`CONNECT` concedido a PUBLIC** em `evogo_auth`/`evogo_users` (default do PG) → endurecer se o servidor vier a ser compartilhado. Sem Redis.

### F7 — Capacidade
Atual: stack usa **~134 MiB** de 3.3 GiB (cap do evolution-go 512 MiB). Para +4 contêineres Evolution Go (Stagent prod/stg, Conecta prod/stg):
- **Por uso medido** (~28 MiB cada): 5×28 + Postgres ≈ 0.3 GiB → cabe com folga enorme.
- **Pelo limite declarado de 512 MiB/container** (base de planejamento): 5×512 = 2.56 GiB + Postgres(es); a folga de 25% de 3.3 GiB pede uso ≤ ~2.48 GiB → **não cabe pela regra dos caps** (faltam ~0.6–0.9 GiB). Opções: subir o plano (vhf-2c-4gb → 6/8 GB) **ou** baixar o limite por contêiner (~300 MiB) **ou** uma instância compartilhada. **Decisão do André.**

---

## G. Integrações (descobrível sem consoles)
- **Google Calendar:** credenciais em `platform_credentials` (`google_calendar`) ou na linha de integração do workspace — **não em env**; `META_APP_ID`/`INSTAGRAM_APP_ID` são as sementes públicas. Escopos `calendar.events` + `userinfo.email`. Redirect `{origin}/api/integrations/google/callback`. Client ID/Project ID **não descobríveis** (em segredo/DB) → perguntar ao André se precisar.
- **Meta:** provedores `meta_messaging` (WhatsApp/app Facebook) e `instagram_login` (credenciais próprias). IDs públicos via `/api/integrations/meta/config` (`appId`, `configId`, `instagramConfigId`). Graph `v23.0` (WhatsApp) e `v25.0` (Instagram). Verify token no Vault. Assinatura HMAC `x-hub-signature-256` (2 chaves). App IDs **não descobríveis** aqui (em segredo/DB).
- **Asaas:** ambiente pelo prefixo da chave (`$aact_hmlg_` sandbox / `$aact_prod_` prod). API `access_token`; webhook `asaas-access-token`. Chave = `clientId`, token do webhook = `clientSecret` do provedor `asaas` (Vault).
- **OpenAI:** `OPENAI_API_KEY` (chat `gpt-4o-mini-*`, embeddings `text-embedding-3-small`, TTS/transcribe).

---

## H. Paridade produção × staging

| Item | Produção | Staging | Situação | Severidade |
|---|---|---|---|---|
| Worker | `odontobox` (custom domain `odontobox.venn360.com`) | **não há Worker de staging dedicado** (só previews efêmeros `pr-N` em `workers.dev`) | **inexistente** | **crítica** |
| Banco (branch) | branch `production` (`ep-icy-mode`) | branch `staging` (`ep-lucky-pond`) — isolada, mas **atrás de produção** (faltam tabelas de broadcast) | **isolado**, desatualizado | alta |
| Hyperdrive | — | — | inexistente (nenhum) | — |
| R2 | `odontobox-public`/`-private` | **mesmos buckets** (não há par de staging) | **compartilhado** | **crítica** |
| Filas / DO | `odontobox-*` / 3 DOs | **mesmas** (previews produzem nas filas de produção) | **compartilhado** | **crítica** |
| Secrets | no Worker `odontobox` | **mesmos** (preview usa o mesmo Worker/escopo) | **compartilhado** | **crítica** |
| Evolution | 1 contêiner no VPS (1 número) | **mesmo** (não há Evolution de staging) | **compartilhado** | **crítica** |
| Google / Meta / Asaas | credenciais de plataforma no DB/Vault | **mesmas** (um só banco por ambiente de app, mas staging lê as mesmas linhas) | **compartilhado** | alta |
| E-mail | `mail.venn360.com` (envia a clientes reais) | **mesmo remetente** | **compartilhado** | alta |
| Crons com efeito externo | 12 ativos no Worker de produção | previews suprimem crons (`CF_PREVIEW`) | isolado (ok) | — |
| Access | `evo-odontobox.venn360.com` | **mesmo** | **compartilhado** | média |

**Leitura:** a Odontobox **não tem um ambiente de staging isolado de verdade** — há a branch Neon `staging` (isolada no banco, mas desatualizada) e previews efêmeros que **reusam Worker, filas, DO, R2, secrets, Evolution e e-mail de produção**. Pela regra (qualquer recurso compartilhado prod×stg é **crítico**), isto é o principal débito a corrigir na Fase 02 e o modelo a **não** repetir nos novos apps (R3/R9 exigem par por ambiente).
