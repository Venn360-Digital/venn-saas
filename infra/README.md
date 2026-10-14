# OdontoBox360 — deployment on a single VPS (Stay Cloud)

Everything runs on one host via Docker Compose: Traefik, self-hosted Supabase,
Evolution Go, Redis, the Next.js app and the worker process.

> **Two compose files. Pick the right one before running anything.**
>
> - `infra/compose.yaml` stands up that whole world from nothing — Traefik,
>   Supabase and Redis included. Sections 1–5 below describe this path.
> - `infra/compose.staycloud.yaml` layers only *our* services onto a host that
>   already runs Traefik, Supabase and Redis. **This is what the live Stay Cloud
>   host uses.** `compose.yaml` must never run there: it would fight the existing
>   proxy for ports 80/443, and a second Supabase does not fit in 3.9 GB.
>
> On the live host, every `docker compose` in this document needs
> `-f infra/compose.staycloud.yaml --env-file .env` and must run from the
> repository root — see [Deploy a new version](#deploy-a-new-version).

| Service | Reachable at | Notes |
| --- | --- | --- |
| App (Next.js) | `https://$APP_HOST` | Traefik label |
| Supabase API gateway | `https://$API_HOST` | Traefik file provider |
| Evolution Go | — | internal; SSH tunnel for `/manager` |
| Evolution API v2 | — | opt-in profile, internal |
| Supabase Studio | — | SSH tunnel only, see below |
| Postgres | — | internal; SSH tunnel for `psql` |
| Redis | — | internal only |
| Worker | — | health on `:3001/health`, Docker-internal |

Only `app` and `api` are published. Nothing else needs to be: the app reaches
Evolution Go over the Compose network, and the webhook travels the same way.

Sizing: this stack is built for **8 GB RAM / 4 vCPU**. Supabase alone is ~10
containers.

## WhatsApp providers

Baileys is not used anywhere. Two providers sit behind one interface
(`src/lib/whatsapp`), selected by the integration's channel:

| Channel | Provider | Library | Status |
| --- | --- | --- | --- |
| `whatsapp_qr` | Evolution Go | whatsmeow | in use |
| `whatsapp_business` | Evolution API v2 | Meta Cloud API | wired, no UI yet |

Evolution Go's authentication is worth knowing before debugging it: the
`apikey` header carries the **global key** for admin routes only
(`/instance/create`, `/instance/all`, `/instance/delete/:id`), and the
**per-instance token** everywhere else. The send endpoints take no instance
parameter — the token *is* the addressing. That token lives in
`AgentIntegration.config.token`, and losing it makes the instance unreachable;
`/instance/all` is the only place it can be recovered from.

The Business channel is implemented but not surfaced: it needs Meta credentials
(`accessToken`, `phoneNumberId`, `businessId`) in `config.business`, and there is
no form for collecting them yet. Start it with
`docker compose --profile business up -d` when that lands.

---

## 1. Prerequisites on the VPS

- Ubuntu 22.04+ (or Debian 12), Docker Engine 24+ with Compose v2.20+
  (`include:` support is required).
- DNS A records for both hostnames pointing at the VPS. Create them **before**
  first boot — Traefik requests certificates over the HTTP-01 challenge and will
  fail against a name that does not resolve yet.
- **Ports 80 and 443 free.** Traefik binds them. A VPS that ships its own
  deploy panel usually has a reverse proxy there already; check with
  `ss -tlnp '( sport = :80 or sport = :443 )'` before starting, and decide whether
  to use that proxy instead of ours rather than fighting it for the ports.
- Behind Cloudflare, set both records to **DNS only** (grey cloud) for the initial
  setup. With the orange cloud on, Cloudflare terminates TLS at its edge and its
  "Always Use HTTPS" redirect intercepts the HTTP-01 challenge, so Traefik never
  gets its certificate.

```bash
docker --version && docker compose version
```

## 2. Lock the host down — do this first

```bash
sudo bash infra/scripts/harden-host.sh
```

The vendored Supabase compose publishes ports on the host, and Docker writes its
port mappings directly into iptables, **bypassing ufw's default-deny**. Without
this step Postgres (5432) and Studio (3000) are open to the internet from the
moment the stack starts. The script allows only 22, 80 and 443 and drops
everything else in the `DOCKER-USER` chain.

Verify from your own machine, not from the VPS:

```bash
nmap -Pn -p 22,80,443,3000,5432,8000 <vps-ip>
```

## 3. Vendor the Supabase stack

```bash
./infra/scripts/fetch-supabase.sh
```

Pulls `supabase/supabase`'s `docker/` directory into `infra/supabase/` and records
the commit in `infra/supabase/.supabase-ref`. Nothing in that directory should be
edited — upgrading is re-running the script and reviewing the diff.

It is gitignored, so it is fetched on the host rather than cloned with the repo.
That means the VPS needs git and outbound network access at setup time.

Two upstream details worth knowing, because they have bitten this setup already:
the API gateway service is named **`api-gw`**, not `kong` (the gateway became
pluggable — see the `docker-compose.kong.yml` / `envoy` / `caddy` / `nginx`
overlays), and **`supavisor` publishes `POSTGRES_PORT` on the host**, which is why
step 2 is not optional.

Pin a specific commit with `SUPABASE_DOCKER_REF=<sha> ./infra/scripts/fetch-supabase.sh`.

## 4. Build the environment

```bash
node infra/scripts/setup-env.mjs \
  --app-host odontobox.venn360.com \
  --api-host odontobox-api.venn360.com
```

The two hostnames are independent, not siblings of one domain. That keeps URLs
short — no four-level subdomains — and makes a later move to a dedicated domain a
two-value change. `--domain example.com` is shorthand for `app.` / `api.` under it,
and `--email` overrides the Let's Encrypt contact (derived from the app host
otherwise).

Writes `infra/.env` (mode 0600, gitignored) and renders
`infra/traefik/dynamic.yaml`.

Three stages, and the order matters:

1. Copies upstream's `.env.example`. The Supabase compose references **82
   variables with no default** — SMTP, MFA, SAML, SMS, pooler sizing, Studio
   defaults — and that file is the only authoritative list. Enumerating them by
   hand is how you get a stack that boots and then fails in one service.
2. Runs upstream's own `utils/generate-keys.sh`, which signs `ANON_KEY` and
   `SERVICE_ROLE_KEY` the way its services expect and covers values that are easy
   to miss (`PG_META_CRYPTO_KEY`, `REALTIME_DB_ENC_KEY`, the S3 protocol keys).
3. Applies ours: domain-derived URLs, Redis, Evolution Go, the app's variables,
   and explicit `false` for the features we do not use. `DATABASE_URL` comes last
   because it embeds the password stage 2 generated.

It also blanks `COMPOSE_FILE`. Upstream sets it for its own `run.sh`, and Docker
Compose reads that variable straight out of `.env` — left in place it would make
`docker compose` in `infra/` load upstream's `docker-compose.yml` instead of our
`compose.yaml`.

Then fill in by hand, in `infra/.env`:

- `OPENAI_API_KEY` — único provedor do MVP. O projeto da chave precisa
  permitir um modelo de chat **e** `text-embedding-3-small`: uma allowlist só
  de modelos de chat faz a base de conhecimento falhar com 403.
- Google Calendar: **nada no ambiente**. Cada clínica registra o próprio projeto OAuth em Gerenciamento → Integrações, e as credenciais ficam na linha de `integrations` do workspace.
- `SMTP_*` — password resets and e-mail confirmation need a real sender. Without
  it a user who forgets their password cannot recover it.

Store `infra/.env` in a password manager. Regenerating `JWT_SECRET` invalidates
every session and every key already issued.

## 5. Boot

This boots the from-scratch stack. On the live Stay Cloud host, use the
`compose.staycloud.yaml` invocation from
[Deploy a new version](#deploy-a-new-version) instead.

```bash
cd infra
docker compose config >/dev/null   # validate before pulling anything
docker compose up -d --build
docker compose ps
```

Start order is enforced by the compose file: `migrate` (`prisma migrate deploy`)
runs to completion before `app` and `worker` start, so neither ever talks to a
schema older than its own image.

Follow the first boot:

```bash
docker compose logs -f traefik app worker
```

## 6. Post-boot setup

### Storage bucket

The app writes inbound WhatsApp media to a bucket named `attachments`. Create it
once, via Studio (Storage → New bucket, public) or over the tunnel.

### First user

The database starts empty — this deployment migrates the schema only, with no
data. Create the first account through the app's own signup/onboarding flow at
`https://app.<domain>`.

### Pipeline stages

Inbound WhatsApp contacts are auto-assigned to the first pipeline stage. A
workspace with no stages gets contacts and conversations but no deals (the worker
logs a warning). `POST /api/pipelines/seed` creates the defaults.

### Activate the Evolution Go license

Evolution Go requires a one-time activation before it will serve requests. The
license is free — a community tier with no instance or message limits — but
activation is mandatory and the instance then sends periodic heartbeats (version,
aggregated counters, enabled features, server IP; not message content).

Evolution Go is not published, so reach its manager over a tunnel:

```bash
ssh -N -L 8080:localhost:8080 root@<vps>
```

Then open `http://localhost:8080/manager`, log in with `EVOLUTION_GO_API_KEY`
from `infra/.env`, and complete the activation.

### WhatsApp instances must be re-paired

Sessions do not survive this migration, for two reasons: the host and IP change,
and the QR channel moves from Baileys to whatsmeow, which stores its session
state in an entirely different place. Every connected agent has to read a fresh
QR code — Atendimento → Agentes → Integrações. Plan a window for this.

Note that whatsmeow keeps session state in Postgres (`evogo_users`), not in a
file volume, so `pg_dumpall` already covers it.

---

## Reaching the private services

Studio has unrestricted database access, so it is never published. Tunnel instead:

```bash
ssh -N -L 8000:localhost:8000 root@<vps>    # then open http://localhost:8000
ssh -N -L 5432:localhost:5432 root@<vps>    # psql / Prisma Studio
```

Studio's own login lives in `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.

---

## Operations

### Deploy a new version

On the live Stay Cloud host, from the **repository root** — not from `infra/`:

```bash
git pull
docker compose -f infra/compose.staycloud.yaml --env-file .env up -d --build app worker
```

Three things that bite if you drop them:

- **Run it from the repository root.** Each service declares `env_file: ../.env`,
  resolved relative to the compose file, so the path only works from one level up.
- **`--env-file .env` is not redundant with `env_file:`.** They feed different
  things: `env_file:` puts variables *inside* the container, while `--env-file`
  feeds the `${APP_HOST}` interpolation in the YAML itself. Without it the Traefik
  label renders as ```Host(``)``` and the site answers 404 while every container
  reports healthy — that cost five hours on 2026-10-07.
- **`-f` is not optional.** Bare `docker compose` from `infra/` picks up
  `compose.yaml`, the from-scratch stack, which must never run on this host.

Rebuild only what changed. The app image carries `src/`, so a frontend-only
change needs `app` alone; `worker` only when something under `workers/` or the
shared libraries it bundles moved. `migrate` re-runs on `up`, applying any new
Prisma migration before the new containers take traffic.

A push to `origin/main` deploys nothing by itself. This command is the deploy.

### Scale the workers

The worker is one process consuming all seven queues. To give the AI queue its
own container, run a second service with `WORKER_QUEUES=ai-reply` and
`ENABLE_SCHEDULER=false` — only one process may own the repeatable cron jobs, or
each replica re-upserts the same schedulers on every deploy.

Queue names: `whatsapp-inbound`, `whatsapp-event`, `whatsapp-outbound`,
`ai-reply`, `rag-index`, `agent-webhook`, `cron`.

### Inspect the queues

```bash
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'bull:*:failed'
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" llen 'bull:whatsapp-inbound:wait'
```

Failed jobs are kept for 7 days (see `DEFAULT_JOB_OPTIONS` in
`src/lib/queue/definitions.ts`).

### Backups

One Postgres instance holds both the app schema and Evolution's `evolution`
database:

```bash
docker compose exec -T db pg_dumpall -U postgres | gzip > odontobox360-$(date +%F).sql.gz
```

Also back up the `evolution-instances` volume (WhatsApp auth state) and
`infra/.env`.

### Logs

```bash
docker compose logs -f worker              # job processing
docker compose logs -f app                 # requests, webhook enqueues
docker compose logs --tail=200 traefik     # TLS and routing
```

Worker log verbosity is `LOG_LEVEL` (`debug` | `info` | `warn` | `error`).

### Os dois vigias do Evolution Go

A imagem `evoapicloud/evolution-go` tem dois defeitos que não são nossos e que
nenhum código da aplicação consegue contornar de dentro. Os dois são tratados
por serviços do host, instalados a partir de `infra/scripts/`:

| Serviço | Script | O que vigia |
|---|---|---|
| `odontobox-wa-guard` | `wa-guard.sh` | Desliga o número ~105 s depois de parear. Reinicia o contêiner assim que `LoggedIn=true`. |
| `odontobox-wa-pool` | `wa-pool-guard.sh` | Vaza conexões Postgres até esgotar `max_connections` — e aí **nenhum QR Code é gerado**, em silêncio. Reinicia quando passa de 60 conexões ociosas. |

O segundo foi medido em 2026-10-14: 100 de 100 conexões abertas pelo Evolution
Go, todas ociosas, acumuladas desde a véspera. O sintoma que chega ao cliente é
"o QR não aparece"; a causa só se vê em `docker logs odontobox360-evolution-go-1`:

```
Failed to create container: failed to upgrade database:
pq: sorry, too many clients already
```

Reiniciar devolve as conexões (100 → 6) e **as sessões voltam sozinhas** pelo JID
guardado, porque `CONNECT_ON_STARTUP=true`. Nenhum número precisa ser pareado de
novo.

```bash
scp infra/scripts/wa-pool-guard.sh root@HOST:/usr/local/bin/odontobox-wa-pool.sh
ssh root@HOST 'chmod +x /usr/local/bin/odontobox-wa-pool.sh && systemctl enable --now odontobox-wa-pool'
journalctl -u odontobox-wa-pool -f
```

---

## How requests flow

```
WhatsApp → Evolution Go → POST app/api/webhooks/evolution-go
         (whatsmeow)        └─ normalises the envelope, enqueues,
                               returns 200 in ms
                                   │
                              Redis (BullMQ)
                                   │
        ┌──────────────────────────┼───────────────────────────┐
  whatsapp-inbound            whatsapp-event              cron (scheduled)
  contact/deal/conversation   status, presence,           reminders, recurrence,
  media → Storage             connection state            credit reset, health
  rules → ai-reply (debounced)
                                   │
                              ai-reply
                              credits check → RAG → LLM
                                   │
                            whatsapp-outbound
                            Evolution → WhatsApp
```

The webhook no longer waits on media downloads or the model. That is what makes
the send retryable and keeps the provider from timing out on a slow answer.

Each provider posts its own envelope to its own endpoint
(`/api/webhooks/evolution-go`, `/api/webhooks/evolution`) and the route normalises
it before enqueuing, so no processor branches on provider. The inner WhatsApp
protobuf object is identical for both, which is why one decoder serves them.

Media bytes arrive inline as base64 (`WEBHOOKFILES=true`), so the worker uploads
straight to Supabase Storage. Payloads above 2 MB are stripped from the job and
fetched via `POST /message/downloadmedia` instead — a base64 video would otherwise
sit in Redis and crowd out the queue.

---

## Troubleshooting

**Traefik serves a self-signed certificate.** DNS was not resolving when the
certificate was requested. Fix DNS, then
`docker compose restart traefik`. Inspect with
`docker compose logs traefik | grep -i acme`.

**App returns 503 on a webhook endpoint.** `REDIS_URL` is missing or Redis is
unreachable. The route answers 503 rather than dropping the event, so the provider
retries. Check `docker compose ps redis`.

**Evolution Go rejects every call with 401.** Either the global key does not match
`EVOLUTION_GO_API_KEY`, or a per-instance call is using the global key. Admin
routes take the global key; everything else takes the instance token. A 401 on
`/send/text` almost always means `config.token` is missing or stale — reconnect the
integration to mint a new one.

**"A instância existe no Evolution Go mas o token não pôde ser recuperado."** The
instance name is taken by one whose token we no longer have. Delete it in the
Evolution Go manager (over the tunnel) and reconnect.

**Messages arrive but the agent never answers.** In order: is the agent
`isActive`? Is the conversation assigned to a human (the agent stays quiet by
design)? Does the workspace have credits — look for `out of credits` in the worker
log and for an internal note on the conversation? Then
`docker compose logs worker | grep AI_REPLY`.

**Media shows as a broken link.** The `attachments` bucket does not exist or is
not public. WhatsApp's own URLs are encrypted and never render directly.

**`prisma migrate deploy` fails on boot.** Read `docker compose logs migrate`.
`app` and `worker` are held back deliberately until it succeeds.
