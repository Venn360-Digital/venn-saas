# FASE 10 — Secrets, CI/CD e primeiro deploy em homologação

**Onde executar:** repositório do novo app, branch `chore/dup-cicd`.
**Modo:** Plan mode. Leia `infra/runbook/01-REGRAS-GLOBAIS.md` (R8).

---

## 1. Secrets do Worker (por ambiente)

1. A partir do inventário A3, monte a lista de TODOS os secrets necessários. Exemplos:
   - `BETTER_AUTH_SECRET`, `IDENTITY_TOKEN`
   - `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `CF_ACCESS_CLIENT_ID_EVO`, `CF_ACCESS_CLIENT_SECRET_EVO`
   - `GOOGLE_CLIENT_SECRET`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `WHATSAPP_CLOUD_TOKEN`
   - `TURNSTILE_SECRET`, credenciais R2 S3 (se houver)
   - chaves de pagamento, Sentry e IA
2. Para cada secret e ambiente, defina a origem:
   - **gerado agora:** `openssl rand -base64 48`;
   - **lido de `~/.venn360-secrets/{slug}/`:** valores das Fases 06–09.

   Nenhum valor pode vir da Odontobox.
3. Grave com `wrangler secret put <NOME> --env stg` e `--env production`, passando o valor via stdin a partir do arquivo, sem eco no terminal.
4. Gere `infra/reports/{slug}/secrets-fingerprints.md` com uma tabela `NOME | env | sha256[:8] | origem | data`.
   - Valide que nenhum fingerprint se repete entre `prod` e `stg`.
   - Exceção: valores que são públicos por natureza.

## 2. GitHub Environments

| Environment | Proteções | Secrets |
|---|---|---|
| `stg` | branch `staging` | `CLOUDFLARE_API_TOKEN` (`{slug}-ci`), `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL_MIGRATOR` (branch staging), `IDENTITY_TOKEN`, `CF_ACCESS_CLIENT_ID`/`SECRET` (service token `{slug}-ci-stg`) |
| `production` | branch `main` + **required reviewer: André** | os mesmos nomes, com valores de produção |

Grave com `gh secret set --env <env>`, lendo dos arquivos locais.

## 3. Workflows (`.github/workflows/`)

**`ci.yml`** — dispara em PR para `staging`/`main`:
1. install
2. typecheck, lint, testes
3. `npm run audit:isolation -- --strict`
4. gitleaks

**`deploy-stg.yml`** — dispara em push em `staging`, com `environment: stg` e `concurrency: deploy-stg`:
1. checkout + install
2. `npm run audit:isolation -- --strict`
3. `node scripts/migrate-guarded.mjs --expect-slug {slug} --expect-env stg`
4. build (OpenNext)
5. `wrangler deploy --env stg`
6. smoke test (seção 4); em caso de falha → `wrangler rollback --env stg` e o job falha

**`deploy-prod.yml`** — dispara em push em `main`, com `environment: production` (aprovação manual) e `concurrency: deploy-prod`. Mesmas etapas, com `--expect-env production` e `--env production`.

Regras dos workflows:
- Nenhum workflow contém IDs ou hostnames fixos de outro app. A auditoria verifica.
- Fixe as actions por SHA ou versão major.

## 4. Smoke test (`scripts/smoke-identity.mjs`)

1. Chama `GET https://<host do ambiente>/api/_internal/identity` com `x-identity-token` e, em `stg`, os headers do service token do Access.
2. Compara a resposta com `infra/manifest.json`:
   - `app.slug`/`app.env`;
   - `db.sentinel` = (`{slug}`, env);
   - host do banco ∈ hosts Neon do manifesto daquele ambiente;
   - host do Evolution = hostname do manifesto;
   - buckets = manifesto.
3. Garante que NENHUM valor consta em `infra/fingerprints/` de outro app.
4. Qualquer divergência → exit 1.

## 5. Ativação e primeiro deploy

1. Reative o GitHub Actions do repositório:
   ```bash
   gh api -X PUT repos/<repo>/actions/permissions -F enabled=true
   ```
2. Merge do PR em `staging` → o deploy de homologação roda.
3. **Certificado de `homolog.{slug}.venn360.com`:** após a criação do custom domain, verifique o certificado (painel/API ou `curl -vI`). Ele deve estar ativo e válido. Se não ficar ativo em 30 minutos, PARE e siga a "Atenção 1" das Regras Globais.
4. Confirme que o Access bloqueia o acesso anônimo ao host de homologação e libera os paths de webhook.

## 6. Proteção cruzada na Odontobox (PR separado no repo da Odontobox)

- Adicione `infra/fingerprints/{slug}.json` ao repositório da Odontobox. A partir daí, a auditoria da Odontobox também passa a proibir recursos deste app.
- Garanta que o CI da Odontobox roda `audit:isolation`.
- Esse PR segue o fluxo da Odontobox: staging, depois "OK produção".

## 7. Limpeza dos segredos locais

Somente após o "OK fase 11" (testes aprovados), e com "confirmo": apague `~/.venn360-secrets/{slug}/` OU mova o conteúdo para o gerenciador de senhas do André. Recomendado: mover. Não apague nesta fase.

## Saídas

- Workflows, `scripts/smoke-identity.mjs`, `secrets-fingerprints.md`.
- PR de proteção cruzada na Odontobox.
- `infra/reports/{slug}/fase-10.md`: link do primeiro deploy de homologação, resultado do smoke test, status do certificado e do Access.

## Critérios de saída

- [ ] Deploy de homologação verde, com smoke test passando.
- [ ] Produção ainda NÃO implantada.
- [ ] Nenhum secret repetido entre ambientes ou herdado da Odontobox.
- [ ] **PARE e aguarde "OK fase 10".**
