# FASE 05 — Clonagem do repositório e rebranding

**Onde executar:** `~/Desktop/Projects/`. O repositório novo será criado nesta fase.
**Modo:** Plan mode.
**Antes de começar:** leia `infra/runbook/01-REGRAS-GLOBAIS.md`.

## Variáveis desta execução (preencha antes de colar o prompt)

```
REPO_ORIGEM      = venn360/<repo-odontobox>
REPO_NOVO        = venn360/stagent360          # conecta: venn360/conecta360
NOME_COMERCIAL   = Stagent360                  # conecta: Conecta360
SLUG             = stagent                     # conecta: conecta
HOST_PROD        = stagent.venn360.com
HOST_STG         = homolog.stagent.venn360.com
EVO_HOST_PROD    = wa.stagent.com.br
EVO_HOST_STG     = stg-wa.stagent.com.br
EMAIL_FROM_PROD  = noreply@mail.stagent.venn360.com
EMAIL_FROM_STG   = noreply@mail-stg.stagent.venn360.com
SUPPORT_EMAIL    = suporte@stagent.venn360.com
PASTA_LOGOS      = <caminho no Mac com logo.svg, logo-mono.svg, favicon, og.png>
SEGMENTO_SEEDS   = none                        # ou o segmento do novo produto
```

---

## Parte 1 — Criação do repositório (independente, com histórico)

1. Confirme que a Odontobox `main` contém as Fases 02, 03 e 04 mergeadas: `scripts/audit-isolation.mjs`, `scripts/migrate-guarded.mjs`, `src/config/app.config.ts` e `EvolutionGoProvider`. Se faltar algo, PARE.
2. `gh repo create REPO_NOVO --private --disable-wiki` (sem README, sem template).
3. **Desative o GitHub Actions do repo novo IMEDIATAMENTE**, antes de qualquer push, para que os workflows herdados não rodem:
   ```bash
   gh api -X PUT repos/REPO_NOVO/actions/permissions -F enabled=false
   ```
4. Espelhamento com histórico:
   ```bash
   cd /tmp && git clone --bare git@github.com:REPO_ORIGEM.git origem.git
   cd origem.git && git push --mirror git@github.com:REPO_NOVO.git
   cd .. && rm -rf origem.git
   ```
   (`--bare` não traz `refs/pull/*`, evitando rejeição do GitHub.)
5. `git clone git@github.com:REPO_NOVO.git ~/Desktop/Projects/<nome-do-repo>`.
6. Remote upstream SOMENTE LEITURA:
   ```bash
   git remote add upstream git@github.com:REPO_ORIGEM.git
   git remote set-url --push upstream DISABLED_NO_PUSH
   ```
   Verifique com `git remote -v`.
7. Branches: mantenha `main` e `staging`. Liste as demais e remova-as do remoto só com "confirmo".
8. Configuração do GitHub:
   - proteção de `main` e `staging`: PR obrigatório, sem force-push;
   - GitHub Environments `production` (required reviewer: André) e `stg`.
   - **NÃO** copie secrets da Odontobox.
9. **Workers Builds (painel Cloudflare):** confirme que nenhum Worker da Odontobox ficou conectado a este repo novo. A conexão é por Worker, mas verifique mesmo assim.

## Parte 2 — Rebranding (branch `chore/dup-identidade`)

1. **`infra/manifest/<app>.json`:**
   - recrie a partir de `infra/runbook/templates/manifest.example.json`, com as variáveis acima e os nomes da convenção;
   - IDs vazios, que serão preenchidos nas Fases 06–08;
   - apague o manifesto herdado da Odontobox.
2. **`infra/fingerprints/`:** mantenha `odontobox.json`. Ele passa a ser a lista proibida deste repo.
3. **`wrangler.jsonc`:**
   - remova TODOS os IDs, nomes de recursos, rotas e custom domains herdados. Substitua por placeholders `__FASE07__` nas posições correspondentes, em `env.production` e `env.stg`;
   - `name` de cada ambiente: `stagent-prod` / `stagent-stg`;
   - a configuração raiz (sem `--env`, usada em dev local) NÃO pode apontar para nenhum recurso de produção.
4. **Identidade:**
   - `src/config/brand.ts` com `NOME_COMERCIAL`, cores e URLs legais do novo produto;
   - copie os logos de `PASTA_LOGOS` para `public/brand/` com os mesmos nomes genéricos;
   - `.env.example` / `.dev.vars.example` com os valores NÃO secretos de staging deste app.
5. **Identificadores herdados:**
   - `package.json` (`name`), README, títulos e metadados;
   - PWA manifest, OG image e páginas legais (privacidade e termos), com textos-base marcados `[REVISAR JURÍDICO]`. As páginas legais são exigidas por Google e Meta.
6. **WhatsApp QR:**
   - provider padrão `evolution_go`;
   - REMOVA `EvolutionApiProvider` e tudo que só ele usa;
   - prefixo de instância = `SLUG-<env>-`.
7. **Seeds:** use `seeds/global/`. Não inclua `seeds/segment/odonto/`.
8. **Funcionalidades do segmento odontológico:** apresente a lista (inventário A10) e pergunte ao André, módulo a módulo: **desligar via feature flag** (padrão recomendado) ou **remover agora**. Não remova sem resposta.
9. **Migrations:** mantenha o histórico de migrations idêntico ao da Odontobox. Não edite nem renumere. Mudanças de schema do novo produto entram como migrations NOVAS, depois.
10. **Workflows herdados** (`.github/workflows/*`): apague os que fazem deploy. Serão recriados na Fase 10. Mantenha só lint e test, se existirem.
11. **Auditoria:** `npm run audit:isolation` deve passar. Placeholders `__FASE07__` são aceitos, mas nenhuma string ou ID do `odontobox.json` pode aparecer. Investigue cada aviso de `warnStrings` e liste-os no relatório.
12. Build local (`npm run build`) e typecheck devem passar.

## Saídas

- Repo `REPO_NOVO` com PR `chore/dup-identidade` (merge em `staging` só após "OK fase 05").
- `infra/reports/stagent/fase-05.md`:
  - remotes;
  - branches;
  - arquivos alterados;
  - decisões sobre módulos do segmento;
  - avisos da auditoria;
  - pendências de marca.

## Critérios de saída

- [ ] Actions desativado no repo novo até a Fase 10.
- [ ] `git push upstream` impossível (testar e mostrar erro).
- [ ] Auditoria de isolamento passando.
- [ ] Nenhum ID/rota herdado no `wrangler.jsonc`.
- [ ] **PARE e aguarde "OK fase 05".**
