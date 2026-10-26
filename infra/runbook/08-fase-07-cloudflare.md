# FASE 07 — Cloudflare do novo app (Hyperdrive, R2, KV/Queues/DO, DNS, e-mail, Access, WAF)

**Onde executar:** repositório do novo app, branch `chore/dup-cloudflare`.
**Modo:** Plan mode. Use o MCP da Cloudflare e/ou wrangler com o token DEDICADO deste app (`{slug}-provisioning`). Aplique R4 e R5 em cada escrita.
**Antes de começar:** leia `infra/runbook/01-REGRAS-GLOBAIS.md`, `infra/manifest.json` e o inventário da Odontobox, item C, para replicar os MESMOS tipos de recurso.

---

## Regra desta fase

Para cada recurso que a Odontobox usa (inventário C4–C9), crie o equivalente do novo app **duas vezes**, uma para `production` e outra para `stg`, com os nomes da convenção. Se a Odontobox usa algo que esta lista não cobre, crie também, seguindo a mesma lógica, e reporte.

Tudo que for criado entra no `infra/manifest.json`, no ambiente correto, no mesmo momento.

## Passos

### 1. Hyperdrive (×2)

- `{slug}-prod-db` → connection string DIRETA da role `{slug}_app`, branch `production`;
- `{slug}-stg-db` → idem, branch `staging`;
- leia as credenciais de `~/.venn360-secrets/{slug}/`;
- caching igual ao da Odontobox.

### 2. R2 (×2)

- `{slug}-prod-files` e `{slug}-stg-files`;
- CORS restrito ao host do próprio ambiente;
- `r2.dev` público DESLIGADO (a menos que a Odontobox comprovadamente dependa de acesso público; nesse caso, use custom domain próprio e pergunte);
- lifecycle igual ao da Odontobox;
- se o app usa a API S3 (presigned URLs): token R2 com escopo **apenas no bucket do ambiente**, com credenciais em `~/.venn360-secrets/{slug}/`.

### 3. KV, Queues, Durable Objects, Workflows, Secrets Store

- Recrie cada um por ambiente, com os nomes da convenção.
- **Durable Objects** pertencem ao Worker. Basta manter as classes e as migrations de DO no `wrangler.jsonc` de cada ambiente.
- **Queues:** produtor e consumidor sempre do MESMO ambiente.
- **Secrets Store:** só se a Odontobox usa. Store/segredos com nome do app, nunca compartilhados entre apps.

### 4. `wrangler.jsonc`

- Substitua cada `__FASE07__` pelo ID ou nome correto do ambiente.
- Custom domains:
  - `env.production.routes` = `[{ "pattern": "stagent.venn360.com", "custom_domain": true }]`;
  - `env.stg.routes` = `[{ "pattern": "homolog.stagent.venn360.com", "custom_domain": true }]`.
- vars não secretas por ambiente: `APP_SLUG`, `APP_ENV`, `APP_URL`, `APP_NAME`, `EMAIL_FROM`, `SUPPORT_EMAIL`, `EVOLUTION_BASE_URL`, `AUTH_COOKIE_PREFIX={slug}`, `TRUSTED_ORIGINS`, `OUTBOUND_ALLOWLIST` (só stg) e `SIMULATE_EXTERNAL` (stg = `true` para crons com efeito externo).
- Crons:
  - em `stg`, mantenha apenas os que não têm efeito externo, ou os que respeitam `SIMULATE_EXTERNAL`;
  - documente a decisão por cron.
- Rode `npm run audit:isolation -- --strict`. Deve passar SEM placeholders restantes.

### 5. DNS e certificados

- Os custom domains dos Workers são criados no primeiro deploy (Fase 10). Nesta fase, só confirme que `stagent.venn360.com` e `homolog.stagent.venn360.com` NÃO existem como registros em uso. Se existirem, PARE.
- **Evolution:** confirme que a zona `stagent.com.br` existe na conta. Crie registros **A** `wa` e `stg-wa` → IP da VPS, **proxied**.
  - Se a zona não existir: PARE e pergunte (fallback na convenção).
- **SSL da origem Evolution:**
  - verifique o modo SSL da zona `stagent.com.br`;
  - se não for Full (strict), NÃO altere zone-wide (R4). Crie uma **Configuration Rule** por hostname (`wa.stagent.com.br`, `stg-wa.stagent.com.br`) com SSL = Full (strict);
  - a origem precisa de certificado válido: Caddy/Traefik com ACME, ou Cloudflare Origin CA instalado no proxy. A configuração é feita na Fase 08.

### 6. E-mail

- **Envio:** configure os domínios remetentes `mail.stagent.venn360.com` (prod) e `mail-stg.stagent.venn360.com` (stg) no mesmo produto de envio usado pela Odontobox. Crie os registros SPF, DKIM e DMARC exigidos para ESSES subdomínios.
  - DMARC inicial: `p=none` com `rua` para a caixa de relatórios. Endureça para `quarantine` após 2 semanas limpas.
  - **NÃO** toque em SPF, DKIM, DMARC ou MX do apex `venn360.com` (R4).
  - Informe ao André o `sp=` atual do DMARC do apex, porque ele afeta estes subdomínios.
- **Recebimento:** Email Routing para `suporte@stagent.venn360.com` → caixa definida pelo André (pergunte). Habilitar o Email Routing em subdomínio cria MX somente para esse subdomínio. Confirme que o MX do apex continua intacto antes e depois.
- Binding de envio (`send_email` ou equivalente) por ambiente, com remetente correto.

### 7. Turnstile (se usado)

Widgets `{slug}-prod` e `{slug}-stg`, com hostnames restritos ao do ambiente. Sitekey como var e secret key como secret (Fase 10).

### 8. Access

- **Aplicação `{slug}-stg`:** host `homolog.stagent.venn360.com`, política de e-mails autorizados (pergunte quais).
  - Bypass para `/api/webhooks/*` (protegido por assinatura) e `/api/auth/callback/*`, se o OAuth precisar.
  - Service token `{slug}-ci-stg` para os smoke tests.
- **Aplicação `{slug}-prod-admin`:** host `stagent.venn360.com`, path `/admin*` (ajuste aos paths administrativos reais).
- **Evolution:**
  - aplicações para `wa.stagent.com.br` e `stg-wa.stagent.com.br`, com política **somente service token**;
  - service tokens `{slug}-worker-evo-prod` / `{slug}-worker-evo-stg` (o Worker envia os headers `CF-Access-Client-Id/Secret` ao chamar o Evolution);
  - bypass apenas se o Evolution precisar receber callbacks externos (normalmente não precisa).

### 9. WAF e rate limiting

- Replique as regras da Odontobox (inventário C7), filtradas por `http.host` do novo app.
- Mínimo: rate limit em `/api/auth/*` por IP.
- Verifique antes a cota de regras do plano. Se não houver cota, NÃO altere regras existentes. Reporte e pergunte.

### 10. Token de CI

Crie o API token `{slug}-ci` (Workers Scripts Edit, Workers Routes Edit nas zonas necessárias, Account Settings Read, mais o que o deploy exigir). Ele será gravado no GitHub Environment na Fase 10. O token é separado do token da Odontobox, para poder ser revogado de forma independente.

## Verificações

- Para cada recurso criado, liste nome, ID e ambiente, e confirme R5: o recurso consta no manifesto e não consta em `odontobox.json`.
- `npm run audit:isolation -- --strict` passando.
- A raiz do `wrangler.jsonc` (dev local) só referencia recursos de `stg`, ou nenhum.

## Saídas

- `wrangler.jsonc`, `infra/manifest.json` e `infra/fingerprints/{slug}.json` atualizados.
- `infra/reports/{slug}/fase-07.md`: recursos por ambiente, regras criadas (com expressão), registros DNS criados, status do MX do apex antes e depois, e pendências.

## Critérios de saída

- [ ] Todos os recursos existem em `production` e `stg`.
- [ ] Nenhuma mudança zone-wide em `venn360.com` ou `stagent.com.br`.
- [ ] Auditoria passando sem placeholders.
- [ ] **PARE e aguarde "OK fase 07".**
