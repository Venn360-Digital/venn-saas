# Kaly — deployment on a single VPS (Stay Cloud)

Everything runs on one host via Docker Compose: Traefik, self-hosted Supabase,
Evolution API, Redis, the Next.js app and the worker process.

| Service | Reachable at | Notes |
| --- | --- | --- |
| App (Next.js) | `https://app.<domain>` | Traefik label |
| Supabase API (Kong) | `https://api.<domain>` | Traefik file provider |
| Evolution API | `https://evo.<domain>` | Traefik label |
| Supabase Studio | — | SSH tunnel only, see below |
| Postgres | — | internal; SSH tunnel for `psql` |
| Redis | — | internal only |
| Worker | — | health on `:3001/health`, Docker-internal |

Sizing: this stack is built for **8 GB RAM / 4 vCPU**. Supabase alone is ~10
containers.

---

## 1. Prerequisites on the VPS

- Ubuntu 22.04+ (or Debian 12), Docker Engine 24+ with Compose v2.20+
  (`include:` support is required).
- DNS A records pointing at the VPS for `app`, `api` and `evo` on your domain.
  Create them **before** first boot — Traefik requests certificates over the
  HTTP-01 challenge and will fail against names that do not resolve yet.

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

Pin a specific commit with `SUPABASE_DOCKER_REF=<sha> ./infra/scripts/fetch-supabase.sh`.

## 4. Generate secrets

```bash
node infra/scripts/generate-secrets.mjs --domain <your-domain>
```

Writes `infra/.env` (mode 0600, gitignored) and renders
`infra/traefik/dynamic.yaml`.

The anon and service-role keys are **not** given to you by self-hosted Supabase:
they are HS256 JWTs signed with `JWT_SECRET`, carrying `role: anon` /
`role: service_role` and `iss: supabase`. The script signs them so the stack does
not boot into a state where every request is rejected.

Then fill in by hand, in `infra/.env`:

- `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `ANTHROPIC_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

Store `infra/.env` in a password manager. Regenerating `JWT_SECRET` invalidates
every session and every key already issued.

## 5. Boot

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

### WhatsApp instances must be re-paired

Baileys sessions do not survive the move off Railway: the host and IP change
invalidate them. Every connected agent has to read a fresh QR code —
Atendimento → Agentes → Integrações. Plan a window for this.

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

```bash
cd infra
git pull
docker compose up -d --build app worker
```

`migrate` re-runs on `up`, applying any new Prisma migration before the new
containers take traffic.

### Scale the workers

The worker is one process consuming all seven queues. To give the AI queue its
own container, run a second service with `WORKER_QUEUES=ai:reply` and
`ENABLE_SCHEDULER=false` — only one process may own the repeatable cron jobs, or
each replica re-upserts the same schedulers on every deploy.

Queue names: `whatsapp:inbound`, `whatsapp:event`, `whatsapp:outbound`,
`ai:reply`, `rag:index`, `agent:webhook`, `cron`.

### Inspect the queues

```bash
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'bull:*:failed'
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" llen 'bull:whatsapp:inbound:wait'
```

Failed jobs are kept for 7 days (see `DEFAULT_JOB_OPTIONS` in
`src/lib/queue/definitions.ts`).

### Backups

One Postgres instance holds both the app schema and Evolution's `evolution`
database:

```bash
docker compose exec -T db pg_dumpall -U postgres | gzip > kaly-$(date +%F).sql.gz
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

---

## How requests flow

```
WhatsApp → Evolution API → POST app/api/webhooks/evolution
                              └─ validates, enqueues, returns 200 in ms
                                   │
                              Redis (BullMQ)
                                   │
        ┌──────────────────────────┼───────────────────────────┐
  whatsapp:inbound            whatsapp:event              cron (scheduled)
  contact/deal/conversation   status, presence,           reminders, recurrence,
  media → Storage             connection state            credit reset, health
  rules → ai:reply (debounced)
                                   │
                              ai:reply
                              credits check → RAG → LLM
                                   │
                            whatsapp:outbound
                            Evolution → WhatsApp
```

The webhook no longer waits on media downloads or the model. That is what makes
the send retryable and keeps Evolution from timing out on a slow answer.

---

## Troubleshooting

**Traefik serves a self-signed certificate.** DNS was not resolving when the
certificate was requested. Fix DNS, then
`docker compose restart traefik`. Inspect with
`docker compose logs traefik | grep -i acme`.

**App returns 503 on `/api/webhooks/evolution`.** `REDIS_URL` is missing or Redis
is unreachable. The route answers 503 rather than dropping the event, so Evolution
retries. Check `docker compose ps redis`.

**Messages arrive but the agent never answers.** In order: is the agent
`isActive`? Is the conversation assigned to a human (the agent stays quiet by
design)? Does the workspace have credits — look for `out of credits` in the worker
log and for an internal note on the conversation? Then
`docker compose logs worker | grep AI_REPLY`.

**Media shows as a broken link.** The `attachments` bucket does not exist or is
not public. WhatsApp's own URLs are encrypted and never render directly.

**`prisma migrate deploy` fails on boot.** Read `docker compose logs migrate`.
`app` and `worker` are held back deliberately until it succeeds.
