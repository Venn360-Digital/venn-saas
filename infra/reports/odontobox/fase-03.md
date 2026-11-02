# Relatório — Fase 03 (Parametrização de identidade + travas)

**Data:** 2026-10-27 · **Branch:** `chore/dup-parametrizacao` (empilhada sobre `chore/dup-saneamento`).

Fase 03 é plan-mode e de alto risco (mexe no login de produção; regra de ouro = zero mudança de comportamento, validação em staging, ativação só com "OK produção"). Como **não é possível buildar/validar vinext+workerd nesta máquina**, implementei o **arcabouço completo de forma fallback-safe e inerte** — nada muda ao mergear/deployar até as novas vars/sentinela existirem (passo de produção). O **typecheck passou**. A varredura total de strings e a religação do Better Auth (as partes que exigem render/login reais) ficam para a validação em staging.

## Implementado nesta branch (seguro / typecheck ok)
**Config central**
- `src/config/brand.ts` — marca ESTÁTICA (nome, tagline, cores, logos, rodapé), valores atuais da OdontoBox. Único lugar da identidade visual/textual.
- `src/config/app.config.ts` — config POR AMBIENTE (zod), **todo campo com fallback ao valor atual**. `slug`/`env` vazios por padrão → travas inertes. Exporta `identidadeConfigurada`.

**Travas**
- **T1** — migration `20261027120000_app_identity` (cria a tabela + índice singleton; **não insere linha**; aplica só no próximo `migrate deploy`).
- **T2** — `scripts/migrate-guarded.mjs` (+ scripts `db:migrate:guarded` e `db:migrate:unsafe`). Lê a sentinela com `DATABASE_URL_MIGRATOR`, aborta em divergência / banco não identificado; `--init` provisiona banco vazio e grava a sentinela.
- **T3** — `src/lib/identidade/guarda.ts` (`verificarIdentidade()`, memoizada por isolate, **no-op enquanto não configurada**; log `IDENTITY_MISMATCH` fail-closed). Hoje consumida por `/api/health` e pelo endpoint T4.
- **T4** — `GET /api/internal/identity` (header `x-identity-token` = `IDENTITY_TOKEN`; retorna app/sentinela/hosts/buckets/version; 503 enquanto sem token).
- **T5** — Better Auth: `advanced.cookiePrefix = AUTH_COOKIE_PREFIX || undefined` (vazio = default `better-auth`, **sessões preservadas**) e `crossSubDomainCookies: { enabled:false }` explícito. `useSecureCookies` deixado no default (não forçado sem poder validar).
- **T6** — `scripts/audit-isolation.mjs` copiado + script `audit:isolation`. Roda e passa (0 vazamentos).

**Rewire de metadados (baixo risco, byte-idêntico hoje)**
- `src/app/layout.tsx` (`title`/`description` ← `BRAND`) e `src/components/layout/DocumentTitle.tsx` (nome ← `BRAND.name`).

**Higiene**
- `/api/health` **mesclado** (preservada a checagem de banco original; +trava T3). Nada removido.

## Deferido para a validação em staging (sweep sensível — precisa de build/render/login)
Estes mexem em superfícies cujo erro só aparece renderizando/logando, e eu não consigo provar aqui. Ficam como o restante da Fase 03, a executar quando houver caminho de staging:
1. **Varredura total do A9** até `odontobox` fora das áreas permitidas = 0: `src/lib/email/layout.ts` (logo/alt/rodapé/`APP_URL`/`CONTATO`), `src/lib/email/templates.ts` e `billing.ts` (corpos), `public/email/*.html` (estáticos — regenerar), `src/app/privacidade/page.tsx`, `src/components/onboarding/Step1Workspace.tsx` (slug default), textos de componentes, `src/lib/nav.ts`, `globals.css` (cores → tokens de `BRAND`).
2. **Better Auth origem:** `ORIGEM_DE_RESERVA`/`HOSTS_PERMITIDOS` → `APP.url`/`APP.trustedOrigins` (é a parte que já derrubou o login quando mexida — só com staging).
3. **T3 global:** estender a trava ao ponto de entrada do Worker (`src/cloudflare/entrada.ts`) para 503 em TODAS as rotas (hoje só health/identity). Precisa de deploy para testar.
4. **Logos → `public/brand/`** com nomes genéricos; **seeds** split `seeds/global/` vs `seeds/segment/odonto/` com `--segment`; **`useSecureCookies`**.
5. **Auditoria T6:** adaptar `audit-isolation.mjs` para ler `cloudflare.config.ts` (vinext) no lugar de `wrangler.*` — hoje a validação de bindings é ignorada (aviso), só a de vazamento roda.

## Testes negativos (pendentes — exigem staging)
- Deploy staging com `APP_ENV=production` → deve dar 503 (T3). 
- `migrate-guarded --expect-slug stagent --expect-env stg` contra o banco da OdontoBox → deve abortar (T2).
- `Set-Cookie` de login sem `Domain=` (T5).

## Ativação (ordem crítica — portão "OK produção fase 03")
1. Inserir a sentinela: staging `('odontobox','stg')`, depois produção `('odontobox','production')` — com confirmação (R6).
2. Gravar vars/secrets novos (`APP_SLUG`, `APP_ENV`, `IDENTITY_TOKEN` [novo, R8], etc.) **ANTES** do deploy que ativa a T3 global — senão a produção responde 503.
3. Deploy, monitorar `IDENTITY_MISMATCH` por 30 min.

## Critérios de saída (estado)
- [~] `odontobox` fora das áreas permitidas = 0 → **parcial** (arcabouço + metadados; sweep sensível deferido a staging).
- [x] T1–T6 implantadas (inertes/fallback-safe); testes negativos pendentes de staging.
- [x] Zero mudança de comportamento ao mergear (por construção; typecheck ok). Sessões preservadas (cookiePrefix inalterado).
- Prossigo (autorização "não parar"); ativação e sweep sensível aguardam caminho de staging + "OK produção".
