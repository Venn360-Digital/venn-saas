# FASE 03 — Parametrização de identidade + travas (na Odontobox360)

**Onde executar:** repositório da Odontobox, branch `chore/dup-parametrizacao` a partir de `main`, já com a Fase 02 mergeada.
**Modo:** Plan mode. Apresente o plano e a lista de arquivos afetados antes de editar.
**Antes de começar:** leia `infra/runbook/01-REGRAS-GLOBAIS.md` e o inventário `infra/inventory/odontobox.md`, item A9.

---

## Objetivo

1. Concentrar toda a identidade do produto em UM lugar. Duplicar passa a ser preencher configuração, e não caçar strings.
2. Implantar as travas T1–T6 (Regras Globais, seção 5) na base comum, para que os três apps já nasçam protegidos.

**Regra de ouro:** zero mudança de comportamento para os usuários da Odontobox. As telas, e-mails, URLs e cookies em produção devem continuar idênticos.

Exceção controlada: o `cookiePrefix`. Se hoje ele é o padrão (`better-auth`), mudar para `odontobox` derrubaria todas as sessões ativas. Neste caso:

- mantenha o valor atual na Odontobox, configurado via env;
- os novos apps usarão seu próprio slug.

---

## Parte 1 — Configuração central de identidade

1. Crie `src/config/app.config.ts` (ajuste o caminho ao padrão do projeto). Ele exporta um objeto tipado e validado (zod), montado a partir de:
   - **env/vars (por ambiente):** `APP_SLUG`, `APP_ENV` (`production` | `stg`), `APP_URL`, `APP_NAME`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `SUPPORT_EMAIL`, `EVOLUTION_BASE_URL`, `AUTH_COOKIE_PREFIX`, `TRUSTED_ORIGINS` (lista), `OUTBOUND_ALLOWLIST` (só stg), `SIMULATE_EXTERNAL`;
   - **marca (estático, por app):** `src/config/brand.ts` com nome comercial, cores (tokens), caminhos de logo (`/brand/logo.svg`, `/brand/logo-mono.svg`, `/brand/favicon.ico`, `/brand/og.png`), telefone, rodapé de e-mail e URLs das páginas legais.
2. Mova os arquivos de logo/ícones da Odontobox para `public/brand/`, com nomes GENÉRICOS (sem "odontobox" no nome do arquivo).
3. Substitua TODA ocorrência hardcoded listada no inventário A9 por leitura da configuração. Inclui:
   - metadados (`<title>`, OG, manifest PWA);
   - templates de e-mail;
   - mensagens de WhatsApp padrão;
   - páginas legais e textos de UI com o nome do produto;
   - URLs absolutas e `trustedOrigins`.
4. **Better Auth:**
   - `baseURL` ← `APP_URL`;
   - `trustedOrigins` ← `TRUSTED_ORIGINS`;
   - `advanced.cookiePrefix` ← `AUTH_COOKIE_PREFIX`;
   - `advanced.crossSubDomainCookies` **desativado** explicitamente;
   - `useSecureCookies: true` fora de dev.
5. **Seeds:** separe em `seeds/global/` (planos, papéis, permissões, templates genéricos) e `seeds/segment/odonto/` (específicos de odontologia). O script de seed recebe `--segment odonto|none`.
6. **Funcionalidades do segmento:** NÃO remova nada. Se ainda não existir, introduza uma flag de configuração `features` em `app.config.ts` (ex.: `odontograma: true`) para que os novos apps possam desligar módulos sem apagar código. Os valores da Odontobox ficam todos `true`.
7. Garanta que, após a mudança, a busca por `odontobox` (case-insensitive) fora de `src/config/brand.ts`, `public/brand/`, `infra/` e dos arquivos de configuração de ambiente retorne ZERO ocorrências.

## Parte 2 — Travas

### T1 — Sentinela

Crie uma migration que cria a tabela, SEM inserir linha:

```sql
CREATE TABLE IF NOT EXISTS app_identity (
  slug text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('production','stg')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_identity_singleton ON app_identity ((true));
```

O índice único garante no máximo 1 linha. A linha é inserida pelo provisionamento: para a Odontobox, no passo de validação abaixo. Permissões: a role da aplicação tem apenas `SELECT` nesta tabela.

### T2 — `scripts/migrate-guarded.mjs`

Uso: `node scripts/migrate-guarded.mjs --expect-slug <slug> --expect-env <production|stg> [--init]`

O script segue estes passos, nesta ordem:

1. Conecta com `DATABASE_URL_MIGRATOR` (env).
2. Se a tabela `app_identity` existe: lê a linha. Se slug ou ambiente forem diferentes do esperado, ou se não houver linha → **ABORTA** (exit 1) com mensagem clara, mostrando o host do banco (sem credencial).
3. Se a tabela não existe:
   - Se o banco tem qualquer tabela no schema `public` → **ABORTA**: "banco não identificado".
   - Se o banco está vazio e `--init` foi passado → roda as migrations e insere a sentinela com o slug/env esperados.
   - Sem `--init` → **ABORTA**.
4. Caso tudo confira → roda as migrations normalmente, usando a ferramenta atual (Drizzle/Prisma).

Substitua os scripts `db:migrate` do `package.json` para passarem SEMPRE pelo guard. O comando sem guard fica disponível só como `db:migrate:unsafe`, sem uso no CI.

### T3 — Verificação em runtime

Implemente no ponto de entrada do servidor (middleware/handler raiz) uma verificação memoizada por isolate:

- Na primeira requisição, faz `SELECT slug, environment FROM app_identity` e compara com `APP_SLUG`/`APP_ENV`.
- Se divergir ou não houver linha: todas as rotas respondem 503 com mensagem genérica, e um `console.error` estruturado registra `{evento: "IDENTITY_MISMATCH", esperado, encontrado, dbHost}`.
- Cache do resultado positivo por isolate. Cache do negativo também: não martelar o banco.
- Rota de health simples (`/api/health`) também respeita a trava.

### T4 — Endpoint de identidade

`GET /api/internal/identity` exige o header `x-identity-token` igual ao secret `IDENTITY_TOKEN`. Responde JSON com:

- `app` (APP_SLUG/APP_ENV);
- `db` (sentinela + host do Hyperdrive/origem, sem usuário e senha);
- `evolution` (host de `EVOLUTION_BASE_URL`);
- `r2` (nomes dos buckets dos bindings, se disponíveis);
- `version` (commit SHA de build).

### T5 — Cookies

Já coberto na Parte 1, item 4. Adicione um teste automatizado: a resposta de login não contém `Domain=` no `Set-Cookie`.

### T6 — Auditoria estática

- Copie `infra/runbook/templates/audit-isolation.mjs` para `scripts/audit-isolation.mjs`.
- Adicione o script `"audit:isolation": "node scripts/audit-isolation.mjs"`.
- Rode localmente. Na Odontobox, a pasta `infra/fingerprints/` terá só `odontobox.json`, que é o próprio app e portanto é ignorado. A auditoria deve passar, validando ao menos a coerência entre `wrangler` e `manifest.json`.

---

## Validação (staging primeiro)

1. Insira a sentinela no banco de **staging** da Odontobox. É escrita: mostre o SQL e peça confirmação.
   ```sql
   INSERT INTO app_identity (slug, environment) VALUES ('odontobox','stg');
   ```
   Use o valor de `APP_SLUG` definido para a Odontobox (curto, ex.: `odontobox`) e registre-o no manifesto.
2. Configure as novas vars/secrets do staging (`APP_SLUG`, `APP_ENV`, `IDENTITY_TOKEN`…). O `IDENTITY_TOKEN` é novo, gerado conforme R8.
3. Faça o deploy em staging e rode o checklist de regressão da Fase 02.
4. **Teste negativo:** em um deploy de preview ou localmente com `.dev.vars` apontando para o banco de staging, defina `APP_ENV=production`. A aplicação DEVE responder 503. Registre a evidência e desfaça.
5. **Teste negativo do guard:** `migrate-guarded --expect-slug stagent --expect-env stg` contra o banco de staging da Odontobox DEVE abortar.
6. Compare visualmente com o staging anterior (screenshots) as telas de login e principal e um e-mail de exemplo. Devem estar idênticos.
7. Só após "OK produção fase 03":
   - inserir a sentinela em produção (`'odontobox','production'`), com confirmação;
   - configurar vars e secrets;
   - merge e deploy;
   - monitorar logs por 30 min, procurando `IDENTITY_MISMATCH`.

**Ordem crítica em produção:** a sentinela e as vars devem existir ANTES do deploy do código com a trava T3. Caso contrário, a produção responde 503.

## Saídas

- PR `chore/dup-parametrizacao`.
- `infra/manifest/<app>.json` atualizado com as novas vars.
- `infra/reports/odontobox/fase-03.md`: arquivos alterados, evidências dos testes negativos e comparação visual.

## Critérios de saída

- [ ] Busca por `odontobox` fora das áreas permitidas = 0.
- [ ] T1–T6 implantadas e testadas, inclusive os testes negativos.
- [ ] Odontobox em produção idêntica para o usuário. Sessões ativas preservadas.
- [ ] **PARE e aguarde "OK fase 03".**
