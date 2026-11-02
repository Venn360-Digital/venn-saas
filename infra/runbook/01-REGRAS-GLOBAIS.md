# REGRAS GLOBAIS — Duplicação Odontobox360 → Stagent360 / Conecta360

> Leia este arquivo inteiro antes de executar qualquer fase.
> Estas regras prevalecem sobre qualquer instrução de fase. Se uma fase parecer exigir que alguma regra seja quebrada, PARE e pergunte ao André.

---

## 1. Contexto

- **Odontobox360**: SaaS multi-tenant em produção, segmento odontológico. Contém dados de saúde (dados pessoais sensíveis, LGPD). É a FONTE da duplicação.
- **Stagent360** (piloto) e **Conecta360**: novos SaaS multi-tenant. Partem da mesma base e, a partir da duplicação, evoluem de forma independente.
- **Stack**: Next.js com `@opennextjs/cloudflare` em Cloudflare Workers · Neon Postgres via Hyperdrive · Better Auth (multi-tenant) · R2 · e-mail Cloudflare · secrets Cloudflare · Evolution Go em Docker na VPS Vultr (WhatsApp QR-Code) · Google Calendar, Instagram, Messenger, WhatsApp Cloud API · GitHub (org `venn360`).
- **Domínios**: todos os novos produtos são subdomínios da zona `venn360.com`. Essa zona também hospeda o site institucional e o e-mail corporativo da Venn360 (`contato@venn360.com`).

---

## 2. Regras invioláveis

**R1 — Odontobox é somente leitura.**
As exceções são as Fases 02, 03 e 04. Elas alteram a Odontobox SEMPRE em branch + PR, validando primeiro em staging. Qualquer alteração em produção da Odontobox exige "OK produção" explícito do André.

**R2 — Nenhum dado é copiado entre aplicações.**
- Os novos apps nascem com schema + seeds versionados.
- É proibido usar `pg_dump` com dados, copiar objetos R2 ou copiar instâncias do Evolution.
- Após o go-live, também é proibido copiar dados de produção para staging (reset de branch Neon a partir de produção) sem anonimização aprovada.

**R3 — Isolamento por app × ambiente.**

Cada combinação (app, ambiente) tem os SEUS próprios:
- Worker
- projeto, branch e roles Neon
- Hyperdrive
- buckets R2
- KV, Queues e Durable Objects
- secrets
- container Evolution, com banco, role e prefixo Redis próprios
- OAuth clients Google
- Meta App
- widget Turnstile
- aplicação Access

Pode ser compartilhado APENAS:
- a conta Cloudflare e a zona `venn360.com`
- o servidor VPS e o reverse proxy da VPS
- o servidor Postgres/Redis da VPS, desde que banco, role e prefixo sejam isolados
- a org GitHub e o Business Manager da Meta

**R4 — A zona `venn360.com` é compartilhada.**

É PROIBIDO alterar configuração zone-wide:
- modo SSL/TLS, Security Level, Bot Fight Mode
- regras de cache globais, DNSSEC, Page Rules genéricas
- registros DNS de outros hosts
- MX, SPF ou DMARC do apex `venn360.com`

Toda regra nova (WAF, rate limit, cache, Configuration Rule, Access) é filtrada por hostname (`http.host eq "..."`). Se algo exigir mudança zone-wide: pare, explique o impacto e peça OK.

**R5 — Verificar o alvo antes de qualquer escrita.**
Antes de qualquer comando que crie, altere ou apague um recurso de nuvem, imprima: conta/projeto, nome do recurso, ambiente e app. Depois confirme que:
- o recurso consta em `infra/manifest.json` do app em execução;
- o recurso NÃO consta em nenhum `infra/fingerprints/*.json` de outro app.

Se houver divergência, aborte.

**R6 — Comandos destrutivos exigem confirmação explícita.**
Entram nesta regra:
- delete, `DROP`, `TRUNCATE`
- `docker stop/rm/down`, `compose down -v`
- `wrangler delete`, reset de branch Neon
- remoção de DNS
- sobrescrita de secret existente
- force-push, reescrita de histórico

Mostre exatamente o comando e aguarde "confirmo".

**R7 — Lista proibida na VPS.**
- Containers, volumes, redes e bancos que pertençam a outro app (ex.: nome contendo `odontobox`) só podem ser INSPECIONADOS (`docker ps`, `inspect`, `logs`, `stats`).
- Nunca reiniciar, parar, recriar nem alterar o `.env` desses itens.
- Antes de qualquer mudança na VPS, é obrigatório ter snapshot Vultr confirmado.

**R8 — Segredos.**
- São sempre GERADOS NOVOS (`openssl rand -base64 48` ou equivalente) e nunca reaproveitados de outro app ou ambiente.
- Nunca aparecem no chat, em relatórios, em commits ou em logs.
- São gravados via `wrangler secret put`, `gh secret set` ou arquivos locais fora do repositório em `~/.venn360-secrets/<slug>/` com `chmod 600`.
- Relatórios mostram apenas o fingerprint: os 8 primeiros caracteres hex do SHA-256 do valor.

**R9 — Ambientes.**
Todo recurso existe em `production` e em `stg`. Não se cria nada para um ambiente só, salvo instrução explícita.

**R10 — Nomes.**
Seguir a convenção da seção 3. Exceção: recursos JÁ EXISTENTES da Odontobox mantêm seus nomes atuais. Não renomeie Workers, bancos ou buckets em produção.

**R11 — Checkpoint de fim de fase.**
Toda fase termina com três passos:
1. Relatório `infra/reports/<slug>/fase-NN.md`, contendo: o que foi feito, IDs criados, fingerprints de segredos, pendências, desvios e perguntas.
2. Atualização de `infra/manifest.json`.
3. PARADA. Aguarde "OK fase NN" do André antes de seguir.

**R12 — Na dúvida, pare.**
Nunca contorne uma trava (desabilitar auditoria, `--force`, `--no-verify`, pular checks, comentar validação). Uma trava falhando é informação, não obstáculo.

**R13 — Git.**
- Nunca fazer push direto em `main` ou `staging`.
- Trabalhar em branch `chore/dup-<assunto>` e abrir PR.
- Commits pequenos, mensagens em pt-BR: `chore(dup): ...`.

---

## 3. Convenção de nomes

Variáveis por app: `{repo}` = `stagent360` | `conecta360` · `{slug}` (nome curto dos recursos) = `stagent` | `conecta` · `{env}` = `prod` | `stg`.

O slug curto também é usado em `APP_SLUG`, na sentinela e no `cookiePrefix`. Os recursos JÁ EXISTENTES da Odontobox mantêm os nomes atuais (R10).

| Recurso | Padrão | Exemplo (Stagent360) |
|---|---|---|
| Repositório | `venn360/{repo}` | `venn360/stagent360` |
| Ambientes wrangler / GitHub | `production` / `stg` | `wrangler deploy --env stg` |
| Worker | `{slug}-{env}` | `stagent-prod` / `stagent-stg` |
| Projeto Neon | `{slug}` | `stagent` |
| Branches Neon | `production` / `staging` | — |
| Database Neon | `{slug}` | `stagent` |
| Roles Neon | `{slug}_migrator` (DDL) / `{slug}_app` (DML) | `stagent_app` |
| Hyperdrive | `{slug}-{env}-db` | `stagent-prod-db` / `stagent-stg-db` |
| R2 | `{slug}-{env}-files` | `stagent-prod-files` / `stagent-stg-files` |
| KV / Queue | `{slug}-{env}-<função>` | `stagent-prod-cache`, `stagent-prod-jobs` |
| Container Evolution | `evo-{slug}-{env}` | `evo-stagent-prod` / `evo-stagent-stg` |
| Projeto compose / diretório VPS | `evo-{slug}-{env}` / `/opt/evolution/evo-{slug}-{env}/` | — |
| Banco e role Evolution (VPS) | `evo_{slug}_{env}` | `evo_stagent_prod` |
| Prefixo de instância Evolution | `{slug}-{env}-` | `stagent-prod-clinicaX` |
| App (produção) | `{slug}.venn360.com` | `stagent.venn360.com` |
| App (homologação) | `homolog.{slug}.venn360.com` | `homolog.stagent.venn360.com` |
| Evolution (produção) | `wa.{slug}.com.br` | `wa.stagent.com.br` |
| Evolution (homologação) | `stg-wa.{slug}.com.br` | `stg-wa.stagent.com.br` |
| E-mail remetente (produção) | `noreply@mail.{slug}.venn360.com` | — |
| E-mail remetente (homologação) | `noreply@mail-stg.{slug}.venn360.com` | — |
| E-mail suporte | `suporte@{slug}.venn360.com` | — |
| Google Cloud project | `{repo}-prod` / `{repo}-stg` | `stagent360-prod` |
| Meta App | `{Nome}` / `{Nome} (Test)` | `Stagent360` |

**Atenção 1: certificado de `homolog.{slug}.venn360.com`.** São dois níveis abaixo de `venn360.com`, e o Universal SSL gratuito cobre só um (`*.venn360.com`). Para hostnames servidos como **Custom Domain de Worker**, a Cloudflare emite certificado próprio para o hostname. O custom domain é criado no primeiro deploy, e a Fase 10 DEVE confirmar que o certificado ficou ativo (status `active`) antes de seguir. Se não ficar, as opções são Advanced Certificate Manager (pago) ou o hostname plano `homolog-{slug}.venn360.com`. Nesse caso, pare e pergunte ao André.

**Atenção 2: hostnames do Evolution em `{slug}.com.br`.** Exigem que a zona `{slug}.com.br` exista na MESMA conta Cloudflare (Fase 01 verifica). Como `wa.` e `stg-wa.` estão a um nível dessa zona, o Universal SSL cobre os dois. Se a zona não existir, PARE e pergunte. O fallback é `wa-{slug}.venn360.com` / `stg-wa-{slug}.venn360.com`. As regras R4 valem também para a zona `{slug}.com.br`.

**Subdomínios de e-mail** (`mail.{slug}.venn360.com`) recebem só registros DNS (SPF/DKIM/DMARC/MX), sem HTTPS. A profundidade de nível não é problema para eles.

---

## 4. Arquivos de controle (em cada repositório)

| Arquivo | Função |
|---|---|
| `infra/manifest.json` | Fonte única de verdade dos recursos do app em execução, por ambiente |
| `infra/fingerprints/<slug>.json` | Identificadores de CADA app (inclusive o próprio). A auditoria usa os de OUTROS apps como lista proibida |
| `infra/runbook/` | Estes prompts. Ignorado pela auditoria |
| `infra/inventory/` | Inventários. Ignorado pela auditoria |
| `infra/reports/<slug>/` | Relatórios de fase. Ignorado pela auditoria |
| `scripts/audit-isolation.mjs` | Auditoria estática de isolamento (roda no CI) |
| `scripts/migrate-guarded.mjs` | Migrações com trava de sentinela |

---

## 5. Travas obrigatórias

Estas travas são implantadas nas Fases 03 e 10 e valem para os três apps.

- **T1 — Sentinela no banco.** A tabela `app_identity(slug text, environment text, created_at timestamptz)` tem exatamente 1 linha por branch. Ela é inserida pelo provisionamento, NUNCA por migration.
- **T2 — Trava de migrations.** `migrate-guarded` lê a sentinela antes de migrar e aborta quando:
  - slug ou ambiente diferem do esperado;
  - a tabela não existe e o banco já tem tabelas.

  Em banco vazio, só prossegue com `--init --expect-slug X --expect-env Y`.
- **T3 — Verificação em runtime.** Na primeira requisição de cada isolate, o Worker compara `APP_SLUG`/`APP_ENV` com a sentinela. Se divergirem, responde 503 em tudo e registra log crítico.
- **T4 — Endpoint de identidade.** `GET /api/internal/identity`, protegido por token, retorna:
  - slug e env (vars);
  - slug e env da sentinela;
  - host do banco (sem credencial);
  - host do Evolution;
  - nomes dos buckets.

  O smoke test do CI compara a resposta com `infra/manifest.json`.
- **T5 — Cookies.** Better Auth com `crossSubDomainCookies` DESATIVADO (cookies host-only, sem atributo `Domain`) e `advanced.cookiePrefix = {slug}`. Todos os apps vivem sob `venn360.com`: um cookie com `Domain=.venn360.com` vazaria sessão entre produtos.
- **T6 — Auditoria estática.** `scripts/audit-isolation.mjs` no CI, antes de qualquer migration ou deploy.
