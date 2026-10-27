# FASE 06 — Banco de dados (Neon) do novo app

**Onde executar:** repositório do novo app (ex.: `stagent360`), branch `chore/dup-neon`.
**Modo:** Plan mode. Use o MCP da Neon. Aplique R5 antes de cada escrita.
**Antes de começar:** leia `infra/runbook/01-REGRAS-GLOBAIS.md` e `infra/manifest.json`.

---

## Objetivo

Criar um projeto Neon EXCLUSIVO do app, com branches `production` e `staging`, roles separadas por função, schema aplicado via migrations protegidas e sentinela inserida. Nenhum dado de outro app é copiado.

## Passos

1. **Projeto:** crie o projeto Neon `{slug}` (ex.: `stagent`):
   - na MESMA região e versão major do Postgres da Odontobox (inventário D1);
   - na mesma organização Neon;
   - NUNCA como branch do projeto da Odontobox.
2. **Branch de produção:** renomeie a branch padrão para `production`. Habilite a proteção de branch se o plano permitir.
3. **Database e roles** (na branch `production`, ANTES de criar `staging`):
   - database `{slug}`;
   - role `{slug}_migrator`: dona do database e do schema `public`, usada só pelo CI para DDL;
   - role `{slug}_app`: sem DDL. Conceda `CONNECT`, `USAGE` em `public`, `SELECT, INSERT, UPDATE, DELETE` em tabelas e `USAGE, SELECT` em sequences, e configure `ALTER DEFAULT PRIVILEGES FOR ROLE {slug}_migrator ...` para que tabelas futuras herdem os grants;
   - **revogue** `CREATE` em `public` de `PUBLIC`.
4. **Branch `staging`:** crie a partir de `production` enquanto ela ainda está VAZIA (sem migrations e sem sentinela).
5. **Credenciais distintas entre ambientes:**
   - Branches filhas herdam roles e, possivelmente, senhas da branch pai. Verifique.
   - Redefina (`reset_postgres_role_password`) as senhas de `{slug}_migrator` e `{slug}_app` na branch `staging`. Ao final, as 4 credenciais (2 roles × 2 branches) devem ser diferentes. Registre os fingerprints (R8).
6. **Compute:** espelhe a configuração da Odontobox em `production` (min/max CU). Em `staging`, use o menor compute com autosuspend agressivo.
7. **Connection strings:**
   - Obtenha, para cada branch, a connection string DIRETA (não pooled) das duas roles.
   - Salve em `~/.venn360-secrets/{slug}/neon-production.env` e `neon-staging.env` (`chmod 600`), com as chaves `DATABASE_URL_MIGRATOR` e `DATABASE_URL_APP`.
   - Nunca as escreva no repositório nem no chat.
8. **Migrations com trava** (para cada branch, primeiro `staging`, depois `production`):
   ```bash
   set -a; source ~/.venn360-secrets/{slug}/neon-staging.env; set +a
   node scripts/migrate-guarded.mjs --init --expect-slug {slug} --expect-env stg
   ```
   ```bash
   set -a; source ~/.venn360-secrets/{slug}/neon-production.env; set +a
   node scripts/migrate-guarded.mjs --init --expect-slug {slug} --expect-env production
   ```
   O `--init` só funciona em banco vazio. Após esta execução, todas as próximas rodam SEM `--init`.
9. **Seeds globais:** rode o seed com `--segment none` (ou o definido na Fase 05) em `staging`. Em `production`, rode somente os seeds de configuração (planos, papéis, permissões). Nunca dados de teste.
10. **Verificações (registre as saídas):**
    - `SELECT * FROM app_identity;` em cada branch → `({slug}, stg)` e `({slug}, production)`;
    - schema-only de `production` comparado com `infra/inventory/odontobox-schema-prod.sql`. A única diferença esperada é a sentinela (dados), e não o schema. Qualquer outra diferença é bloqueante;
    - **teste negativo:** rode `migrate-guarded --expect-slug {slug} --expect-env production` com as credenciais de `staging`. Deve abortar;
    - a role `{slug}_app` NÃO consegue `CREATE TABLE` (testar e mostrar o erro);
    - o host do endpoint de cada branch NÃO consta em `infra/fingerprints/odontobox.json`.
11. **Manifesto:** atualize `environments.production.neon` e `environments.stg.neon` com project ID, branch ID, host do endpoint, database e roles. NUNCA senhas.
12. **Fingerprint:** crie ou atualize `infra/fingerprints/{slug}.json` com o project ID e os hosts dos endpoints.

## Política permanente (registre no README do repositório)

- Após o go-live, é PROIBIDO resetar `staging` a partir de `production` (cópia de dados de clientes). Massa de teste vem de seeds ou de anonimização aprovada.
- Preview branches (opcional): sempre derivadas de `staging`, nunca de `production`.

## Saídas

- `infra/manifest.json` e `infra/fingerprints/{slug}.json` atualizados.
- `infra/reports/{slug}/fase-06.md`: IDs, fingerprints das 4 credenciais, evidências das verificações.

## Critérios de saída

- [ ] Projeto Neon exclusivo, com 2 branches e 4 credenciais distintas.
- [ ] Sentinela correta em cada branch.
- [ ] Testes negativos com erro esperado.
- [ ] **PARE e aguarde "OK fase 06".**
