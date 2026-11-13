# 16 — Emergência: publicar com o Workers Builds fora do ar

* **Criado em 2026-11-01**, junto com o arquivo 15 (a arquitetura). Vale para os
  3 apps; os sites não têm emergência (esperam o Builds voltar).
* **Decisão de desenho:** não existe workflow de emergência **vivo** no GitHub.
  Workflow que nunca roda apodrece sem ninguém ver — o `deploy.yml` da Odontobox
  passou semanas em 401 provando isso. O caminho de emergência é esta página:
  um YAML pronto para colar + um token que vive **fora** do GitHub.

## Quando usar — e quando NÃO usar

Use **somente** quando as duas coisas forem verdade ao mesmo tempo:

1. O Cloudflare Workers Builds está fora do ar ou recusando builds (status da
   Cloudflare, ou builds presos/failing por causa da plataforma — não do código);
2. existe uma correção de produção que **não pode esperar** o Builds voltar.

NÃO use para: contornar um portão vermelho (o portão vermelho está certo),
"deploy rápido" por conveniência, ou mudança que envolva migração de schema —
veja o limite abaixo.

**Limite: emergência é code-only.** Este caminho publica código; **não migra
banco**. Se a correção exige migração, o passo de migrar roda **desta máquina**
(`pnpm run migrate:prod` com `DATABASE_URL_MIGRATOR` no ambiente — o que não roda
em macOS 12.6 é o *build* do vinext, não o migrador), e só então o YAML publica
o código. Hipótese ainda não medida: deploy local a partir de artefato de build
arquivado (Apêndice B do arquivo 15).

## O que fica guardado onde

| coisa | onde | o que NÃO é |
|---|---|---|
| Este YAML | esta página, no repositório | não é um workflow ativo |
| Token CF de deploy (`emergencia-deploy`, escopo Workers Scripts:Edit na conta) | gerenciador de senhas do André | **nunca** fica permanente no GitHub |
| `CLOUDFLARE_ACCOUNT_ID` | não é segredo (está em todo log de build) | — |

## Roteiro (15 minutos)

1. Confirme a pane: https://www.cloudflarestatus.com + um retry do build no
   painel. Pane de plataforma, não erro do seu código.
2. No repositório do app, crie os dois segredos **temporários**:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN -R venn360/<repo> # cole o token do gerenciador de senhas
   ```

   ```bash
   gh secret set CLOUDFLARE_ACCOUNT_ID -R venn360/<repo>
   ```

3. Crie `.github/workflows/emergencia.yml` com o YAML abaixo (serve igual para
   os 3 apps) e faça merge em `main` junto com a correção — o merge continua
   sendo a aprovação humana, e o dispatch roda o HEAD de `main`.
4. Dispare: `gh workflow run emergencia.yml -R venn360/<repo>` e acompanhe com
   `gh run watch`.
5. **Desmonte no mesmo dia em que o Builds voltar** (a parte que todo mundo
   esquece): apague o workflow num PR, apague os segredos
   (`gh secret delete CLOUDFLARE_API_TOKEN -R ...`, idem `ACCOUNT_ID`) e
   **rotacione o token** no painel da CF — ele viveu no GitHub, então é tratado
   como exposto (regra do Apêndice C do arquivo 15). Confira que o próximo push
   dispara o Workers Builds normalmente.

## O YAML

Derivado do `deploy-stg.yml` que rodou de verdade até 01/11 (histórico do git
dos clones), enxugado: sem `--secrets-file` (o Worker de produção **já tem** os
segredos gravados — segredo de Worker sobrevive a deploy; aquele bloco era para
Worker recém-nascido) e sem o passo de migração (fora por regra — veja o limite
acima). Da verificação, fica a auditoria de isolamento, que roda em qualquer
runner.

> ⚠️ **Durante a transição de gerenciador (a partir de 2026-11-12) o YAML tem
> dois sabores.** A Odontobox está em **pnpm**; o stagent e o conecta ainda
> estão em **npm**. Colar o YAML abaixo num clone falha no primeiro passo,
> porque `pnpm install --frozen-lockfile` não acha `pnpm-lock.yaml` lá. Nos
> clones, troque as duas linhas por `- run: npm ci` e `- run: npx prisma
> generate`, e os `pnpm run` por `npm run` (remova o `pnpm/action-setup`).
> Quando os clones migrarem, apague esta nota.

```yaml
name: EMERGÊNCIA — deploy de produção (Workers Builds fora)

# TEMPORÁRIO. Existe só enquanto durar a pane do Workers Builds.
# Desmontagem obrigatória no roteiro do runbook 16: apagar workflow,
# apagar segredos e ROTACIONAR o token.
on:
  workflow_dispatch:
    inputs:
      confirmo:
        description: 'Digite CONFIRMO — Workers Builds em pane, correção code-only'
        required: true

permissions:
  contents: read

concurrency:
  group: emergencia-prod
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: ${{ inputs.confirmo == 'CONFIRMO' }}
    env:
      BUILD_TARGET: cloudflare
      DEPLOY_ENV: production
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prisma generate
      - name: Auditoria de isolamento (strict)
        run: pnpm run audit:isolation -- --strict
      - name: Build (vinext)
        run: pnpm run build:prod
      - name: Deploy
        run: pnpm run deploy:prod
```

Notas de fidelidade ao terreno:

- `npx cf deploy` (dentro de `deploy:prod`) usa `CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID` do ambiente — é exatamente como o workflow morto
  autenticava.
- `DEPLOY_ENV=production` é o que o `cloudflare.config.ts` lê para escolher o
  nome do Worker e o prefixo dos recursos. Nos clones, produção = nome limpo
  (`stagent`/`conecta`).
- O smoke (`pnpm run smoke:prod`) precisa de `IDENTITY_TOKEN`; em emergência,
  rode-o **desta máquina** depois do deploy, em vez de pôr mais um segredo no
  GitHub: `IDENTITY_TOKEN=... node scripts/smoke-identity.mjs production`.
- Sem migração neste YAML, de propósito. Se a correção precisa de schema, o
  migrador roda desta máquina ANTES do dispatch (limite acima) — e a migração
  tem de ser expand, como sempre.
