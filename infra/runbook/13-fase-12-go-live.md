# FASE 12 — Go-live em produção

**Onde executar:** repositório do novo app.
**Modo:** Plan mode. Leia `infra/runbook/01-REGRAS-GLOBAIS.md`. Toda ação em produção exige "OK produção" do André.

---

## 1. Checklist pré-go-live (tudo ✅ antes do merge em `main`)

- [ ] Fase 11 aprovada, com 100% dos testes ✅.
- [ ] Secrets de `production` gravados e fingerprints diferentes dos de `stg` (Fase 10).
- [ ] Sentinela `({slug}, production)` na branch `production` do Neon.
- [ ] `evo-{slug}-prod` saudável e hostname `wa.{slug}.com.br` respondendo atrás do Access.
- [ ] Google:
  - projeto de produção configurado;
  - status da verificação registrado.
  - Se ainda pendente: OK para operar com até 100 usuários de teste, ou para adiar o recurso de agenda via feature flag.
- [ ] Meta:
  - App Review submetido/aprovado;
  - WABA e número de produção aprovados.
  - Recursos sem aprovação ficam DESLIGADOS por feature flag.
- [ ] Páginas legais revisadas (sem `[REVISAR JURÍDICO]` pendente).
- [ ] Access em `/admin*` de produção.
- [ ] Rate limit/WAF de produção ativos.
- [ ] DMARC dos subdomínios de e-mail sem falhas há pelo menos alguns dias.
- [ ] Observabilidade:
  - projeto Sentry (ou equivalente) de produção;
  - notificações da Cloudflare (erros de Worker, Hyperdrive) para o e-mail do André.
- [ ] Neon: retenção de histórico/PITR de `production` igual ou maior que a da Odontobox.
- [ ] Plano de rollback escrito (seção 3).

## 2. Execução

> **Reescrito em 2026-10-29.** Esta seção descrevia `deploy-prod.yml` e um portão
> de aprovação no GitHub Environment. Nada disso existe mais: o deploy saiu do
> GitHub Actions para o **Cloudflare Workers Builds** em 29/10, porque os minutos
> do GitHub acabaram. O portão foi reconstruído sobre o que existe, e o que mudou
> de verdade é **onde a aprovação humana acontece**: era um botão no GitHub,
> agora é o próprio **merge em `main`**.

### 2.1 Pré-requisitos — sem estes o primeiro deploy falha

- [ ] **O Worker de produção existe.** Hoje a conta tem só `{slug}-stg`. O
      primeiro build do Workers Builds cria `{slug}-prod`.
- [ ] **Os segredos de produção estão gravados** no Worker `{slug}-prod`. O
      `cloudflare.config.ts` os declara com `bindings.secret()`, e **declarar é
      exigir no deploy**: faltando um, o deploy falha antes de publicar. São os
      mesmos ~16 de `{slug}-stg`, com valores de produção.
- [ ] **`DATABASE_URL_MIGRATOR` como variável de build** no Workers Builds (não
      é segredo de runtime: é o papel de DDL, usado só durante o build). Sem ele
      o portão aborta com "DATABASE_URL_MIGRATOR ausente", que é o
      comportamento certo.
- [ ] **A sentinela `({slug}, production)` existe** em `app_identity` da branch
      `production` do Neon. Sem linha, `migrate-guarded` **aborta** — é a trava
      que impede migrar o banco de um app com o código de outro.

### 2.2 Configuração do Workers Builds (produção)

No painel do Worker `{slug}-prod` → Settings → Builds:

| campo | valor |
|---|---|
| Branch | `main` |
| Build command | `npx prisma generate && npm run portao:prod && npm run build:prod` |
| Deploy command | `npm run deploy:prod && npm run smoke:prod` |
| Build variables | `DATABASE_URL_MIGRATOR` |

`portao:prod` é o portão, e ele roda **antes** do build:

1. `migrate:prod` — `migrate-guarded --expect-slug {slug} --expect-env production`.
   Lê `app_identity` antes de migrar e aborta se o banco não for o esperado.
2. `audit:isolation --strict` — recusa vazamento de identidade entre os apps.

`smoke:prod` roda **depois** do deploy e confere, de fora, que a identidade
publicada bate com `infra/manifest.json`.

A ordem importa e não é estética: migração antes do build garante que o código
publicado nunca encontra um schema que não existe; o smoke depois do deploy é a
única prova que enxerga o que foi de fato publicado.

### 2.3 O deploy

1. PR `staging` → `main`. O CI (`ci.yml`) roda typecheck, lint, os testes e
   `audit:isolation --strict`.
2. **O merge em `main` é a aprovação humana.** Ele dispara o Workers Builds de
   produção, que roda o portão, o build e o deploy.
3. Certificado de `{slug}.venn360.com` ativo; `curl -I` → 200/302 esperado.
5. **Primeiro tenant interno** ("Venn360 – interno"):
   - cadastro;
   - e-mail transacional real;
   - conexão WhatsApp QR com número interno;
   - evento de agenda;
   - webhook Meta (se aprovado).
6. Verifique de novo, em produção, os itens W3 e D3 da Fase 11: instâncias e objetos aparecem só nos recursos `prod` do novo app.

## 3. Rollback

- **Código:** `wrangler rollback --env production` (versão anterior), ou revert do merge + novo deploy.
- **Banco:** migrations do go-live devem ser apenas as já existentes. Se houver migration nova, ela precisa ser compatível com a versão anterior do código (expand/contract). Para restaurar, use PITR/branch de restauração do Neon. Nunca restaure a partir de outro app.
- **Evolution:** container `prod` independente. Parar o container (com "confirmo") não afeta outros apps.

## 4. Pós go-live (48 h)

- Monitore logs (`IDENTITY_MISMATCH`, 5xx, falhas de webhook), consumo de RAM da VPS e e-mails rejeitados.
- Política permanente registrada no README: sem cópia de dados de produção para homologação (R2).
- Mova os segredos de `~/.venn360-secrets/{slug}/` para o gerenciador de senhas e apague a pasta local (com "confirmo").

## Saídas

- `infra/reports/{slug}/fase-12.md`: horário do deploy, versão, evidências, status das aprovações pendentes e incidentes.

## Critérios de saída

- [ ] Produção no ar, smoke test verde, tenant interno funcional.
- [ ] Odontobox sem impacto (health, logs, containers).
- [ ] **PARE e aguarde "OK fase 12".**
