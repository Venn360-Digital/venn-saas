# 15 — Arquitetura definitiva: GitHub × Workers Builds, branches, ambientes, rollback

* **Autor:** André (venn360) · análise e execução com revisão multi-lente (EGM, 6 revisores)
* **Data:** 2026-11-01 · fatos medidos nesta data, salvo quando datados
* **Escopo:** os 7 projetos — 3 apps (Odontobox, Stagent, Conecta) + 4 sites (venn360, advogadamohs, janainaleiteadv, visuallaw)
* **Decisões do André que este documento implementa:** zero compra de créditos de GitHub Actions (permanente); aprovação humana de produção = merge em `main`; GitHub Pro recusado; Workers de produção dos clones com nome limpo (`stagent`, `conecta`); staging da Odontobox criado após esta execução.

## 1. Veredito

**Cada plataforma fica só com o que faz melhor, e a duplicação morre.** O GitHub guarda código, Pull Requests e verificação barata (~2 min por PR) — zero builds de Worker, zero deploys, zero segredos de runtime. O Cloudflare Workers Builds é o único caminho de build, preview e deploy, com o portão de produção (migração guardada + auditoria de isolamento) rodando no *deploy command*, onde build falho nunca toca o banco.

**Por que não "voltar para o GitHub" agora que a cota renovou:** o acidente de 29–31/10 foi o deploy ficar refém da cota de *verificação* — 414 execuções mortas em 2 segundos, produção sem caminho por três dias. Separar verificação (GitHub) de publicação (Cloudflare) faz cada cota carregar só a própria carga, e uma pane num fornecedor não derruba a outra metade.

**Custo mensal:** antes, ~3.065 min de Actions em outubro (estourou a franquia; 90% era build pesado da Odontobox) + Workers Builds em paralelo. Depois: GitHub ~300–500 min/mês (folga ≥4× em qualquer plano), Workers Builds ~2.000–3.100 min projetados contra 6.000 do plano Workers Paid. **US$ 0 adicionais.**

**Os três riscos residuais que ficam, com dono:**

| risco | por quê fica | dono / default |
|---|---|---|
| Push direto em `main` publica produção pulando o CI de PR | GitHub Pro (US$ 4/mês) recusado — sem proteção de branch, "aprovação = merge" é disciplina, não trava | André · mitigado por typecheck no build, gitleaks no push e portão no deploy; revisitar se a equipe passar de 1 pessoa |
| GitHub e Cloudflare fora ao mesmo tempo = sem caminho de código novo | build do vinext não roda na máquina local (workerd exige macOS 13.5+) | aceito e escrito · emergência cobre só "Cloudflare Builds fora" (§6.4) |
| Migração aplicada + publish falho = banco novo, código velho por minutos | migração roda no deploy command (depois do build, antes do publish) | mitigado: janela mínima, retry idempotente, lint expand/contract no CI |

## 2. Quadro 1 — Quem faz o quê

| Serviço | GitHub | Workers Builds | Prós | Contras |
|---|:-:|:-:|---|---|
| Código, branches e Pull Requests | **X** | | Fonte única, histórico, revisão por PR | Plano Free não trava `main` |
| Verificação de PR (typecheck, lint, testes, auditoria) | **X** | | ~2 min/PR; falha diz exatamente qual prova quebrou | Push direto pula o CI de PR |
| Varredura de segredos (gitleaks) | **X** | | Roda no PR (diff) **e** no push (histórico completo) | ~1 min/run a mais |
| Build do app (vinext/workerd) | | **X** | Cota própria; compila o alvo que vai ao ar | Também tem cota (6.000/mês no Paid) |
| Preview por PR | | **X** | Mesmo build de produção; URL por PR | Precisa de coleta de lixo (job no fechamento do PR) |
| Deploy homolog e produção | | **X** | Zero segredo de deploy no GitHub; sobrevive a pane/cota do GitHub | Campo de painel sem diff → todo comando é script npm versionado |
| Portão (migração guardada + auditoria `--strict`) | | **X** | No deploy command: build falho não toca o banco | Exige `DATABASE_URL_MIGRATOR` como variável de build |
| Segredos de runtime | | **X** (no Worker) | Um lugar para guardar e rotacionar | Os que viveram no GitHub são rotacionados (Apêndice C) |
| Rollback de código | | **X** (`wrangler rollback`) | Minutos | Bloqueado se o deploy migrou Durable Object → árvore §6.3 |
| Emergência (Builds fora do ar) | página de runbook | | YAML pronto + token fora do GitHub; nada vivo para apodrecer | Só código; não migra |

## 3. Quadro 2 — Ambientes por projeto

| Projeto | Tipo | Produção | Staging | Banco de dados | Contêiner (Evolution/VPS) |
|---|---|:-:|:-:|---|---|
| Odontobox | App | **X** (existe: Worker `odontobox`) | **X** (criar — §7.3) | Neon `production` + `staging` (existem, sentinelas gravadas 29/10) | prod existe · stg a decidir (VPS 1 GB) |
| Stagent | App | **X** (criar: Worker `stagent`, go-live) | **X** (existe: `stagent-stg`) | Neon `production` + `staging` (existem) | prod + stg existem |
| Conecta | App | **X** (criar: Worker `conecta`, go-live) | **X** (existe: `conecta-stg`) | Neon `production` + `staging` (existem) | prod + stg existem |
| venn360 | Site | **X** | — | — | — |
| advogadamohs | Site | **X** | — | — | — |
| janainaleiteadv | Site | **X** | — | D1 (1 migração, aplicada à mão na criação — §7.4) | — |
| visuallaw | Site | **X** | — | Neon (schema em `db/schema.sql`, aplicado à mão) | — |

**Site sem staging — impacto:** nenhum relevante. O preview de PR mostra o site inteiro antes do merge, com o mesmo build que vai ao ar; sem banco com migração, não existe o risco que o staging dos apps protege. Regra: **se um site ganhar banco com migração, ganha portão e reavalia staging.** Sites têm zero workflows no GitHub.

**App com staging obrigatório — por quê:** é o único lugar que processa fila/WhatsApp de verdade fora da produção. Preview **não tem** gatilho de fila nem cron, por desenho medido (um preview com triggers disputaria mensagem real com produção — cada mensagem é entregue a um consumidor só).

## 4. Comparativo por eixo (procedência: M = medido aqui; F = tabela do fornecedor)

| Eixo | GitHub Actions | Cloudflare Workers Builds |
|---|---|---|
| Cota mensal | 2.000–3.000 min conforme o plano (F); outubro consumiu ~3.065 min wall-clock (M) | Free 3.000 min / Paid 6.000 min (F); conta no Paid, inferido pelas 9 filas por app — Queues é recurso pago (M) |
| Minuto ≠ minuto | runner GH mediu preview em 7,6 min (M) | builder CF estimado 6–8 min para o mesmo trabalho — máquinas diferentes, **não** intercambiáveis; confirmar com build real (Apêndice B) |
| Concorrência | 20 jobs (F) | Free 1 build / Paid 6 (F) — no Free, 7 projetos enfileiram atrás de um preview |
| Gatilhos | push/PR/dispatch/cron — dispatch manual com confirmação digitada é nativo | push por branch + previews; sem dispatch manual arbitrário |
| Segredos | ficavam 18 de runtime + tokens CF (M) — superfície dupla | runtime no Worker; build vars só para o portão/smoke |
| Onde a migração roda | rodava no `deploy-stg.yml` (M) | no deploy command, pós-build (§6.2) — semântica de falha: §1, risco 3 |
| Quem dispara deploy | quem tem o token CF no GH + push na branch | quem consegue mergear/pushar a branch vigiada — sem segredo intermediário |
| Falha do fornecedor | 29–31/10: billing bloqueou TUDO, deploy incluso (M) | pane do Builds não impede o GitHub de receber código; emergência §6.4 |
| Auditoria/logs | logs por run, retenção longa, UI por PR | logs por build via API (`GET /accounts/{id}/builds/builds/{uuid}/logs`); histórico por Worker |
| Lock-in | YAML portátil | comandos são scripts npm versionados — o campo de painel só os chama (princípio §6.1) |
| Paridade de build | runner Node genérico; o alvo workerd exigia build dedicado | compila o alvo real (vinext/workerd) — o preview é o build de produção |

## 5. Segurança — por ativo

| Ativo | Exposição ANTES (medida 01/11) | Exposição no modelo | Risco residual · dono |
|---|---|---|---|
| Segredos de runtime (18 por clone) | Em DOIS sistemas: GitHub Actions (`--secrets-file`) e Worker | Só no Worker; variáveis de build da CF para portão/smoke | Exposição passada não se apaga → **rotação obrigatória** (Apêndice C) · André |
| Credencial de deploy (token CF) | Token com poder de publicar vivendo no GitHub; o da Odontobox estava **inválido** (401 permanente = vermelho que ensina a ignorar vermelho) | Nenhum token de deploy no GitHub; deploy acontece dentro da CF via GitHub App | Token de emergência existe fora do GitHub (gerenciador de senhas) · André |
| Banco de produção | `migrate.yml` manual com confirmação; portão escrito mas **não ligado** (comando do painel não o chamava) | Portão no deploy command: `migrate-guarded` aborta se a sentinela `app_identity` não for a esperada; lint expand/contract no PR | Falha pós-migração/pré-publish: janela de minutos, retry idempotente · modelo |
| Worker de produção | Push direto em `main` publicava sem verificação alguma (e ainda publica — sem proteção de branch) | Idem no gatilho, MAS: typecheck no build command, gitleaks no push, portão no deploy | Push direto malicioso/acidental publica · André (GitHub Pro recusado; revisitar com equipe >1) |

Mais dois pontos medidos: (a) dois oleodutos publicando o mesmo Worker (GH + CF simultâneos em 01/11 03:14–03:17) — morrem na fase de corte; (b) gitleaks por push com `--log-opts=--all` era a única varredura que alcançava push direto — preservada no `ci.yml` consolidado.

## 6. O modelo (estado final — só regras)

### 6.1 Princípios
1. GitHub verifica; Cloudflare constrói e publica. Nada duplicado.
2. **Nenhuma lógica em campo de painel** — campo de painel não tem diff, PR nem histórico; todo comando é script npm versionado e o painel só o chama. É o único mecanismo anti-drift entre o documento e a realidade.
3. Build nunca tem efeito colateral; migração mora no deploy command.
4. Aprovação humana de produção = merge em `main` (disciplina declarada, não trava — §1).
5. Vocabulário único nos 3 apps: `build:prod|stg`, `deploy:prod|stg`, `portao:prod|stg`, `migrate:prod|stg`, `smoke:prod|stg`, `build:preview`, `deploy:preview`, `lint:migracoes`.

### 6.2 Perfil App — comandos literais por Worker

| Worker | branch | Build command | Deploy command | Build vars (valores: André) |
|---|---|---|---|---|
| `odontobox` | `main` | `npx prisma generate && npm run typecheck && npm run build:prod` | `npm run portao:prod && npm run deploy:prod && npm run smoke:prod` | `DATABASE_URL_MIGRATOR`, `IDENTITY_TOKEN` |
| `stagent-stg` | `staging` | `npx prisma generate && npm run typecheck && npm run build:stg` | `npm run portao:stg && npm run deploy:stg && npm run smoke:stg` | `DATABASE_URL_MIGRATOR`, `IDENTITY_TOKEN`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` |
| `conecta-stg` | `staging` | idem stagent-stg | idem | idem |
| `stagent` (go-live) | `main` | `npx prisma generate && npm run typecheck && npm run build:prod` | `npm run portao:prod && npm run deploy:prod && npm run smoke:prod` | `DATABASE_URL_MIGRATOR`, `IDENTITY_TOKEN` |
| `conecta` (go-live) | `main` | idem | idem | idem |
| `odontobox-stg` (futuro) | `staging` | como stagent-stg | como stagent-stg | como stagent-stg |

Regras anexas: o `smoke:*` só entra no deploy command **junto** com o `IDENTITY_TOKEN` gravado (sem ele, vermelho pós-publicação vira ruído). Smoke falho = **alarme pós-publicação**, não portão: diagnóstico pela §6.3, nunca rollback automático. A base de previews permanece `build:preview`/`deploy:preview` (CF_PREVIEW=1, sem portão) — **conferir por GET após todo PATCH** que o preview não herdou o portão. Na Odontobox, PR com migração não valida pelo preview (que aponta para produção): valida pelo job `banco` do CI e espera o merge.

### 6.3 Rollback — árvore de decisão (código ≠ banco)
1. `npx wrangler rollback` (minutos). **Recusado quando a versão migrou Durable Object** →
2. Revert + merge: re-passa pelo portão; `prisma migrate deploy` re-rodar é inofensivo (idempotente).
3. Após qualquer rollback: conferir crons e consumidores de fila contra `infra/manifest.json` — rollback de script **não** reverte triggers.
4. **Banco nunca reverte.** Migração aplicada fica; escreve-se a próxima (expand/contract). PITR do Neon só para desastre de dados, nunca para "desfazer deploy".

### 6.4 Emergência — Workers Builds fora do ar
Sem workflow vivo (workflow que nunca roda apodrece; o `deploy.yml` em 401 foi a prova). Em vez disso: **(a)** o YAML de emergência pronto para colar vive em `infra/runbook/16-emergencia-deploy.md`; **(b)** o token CF de deploy vive no gerenciador de senhas do André, nunca no GitHub em regime permanente; **(c)** emergência é **code-only** — se a correção exige migração, o caminho é `npm run migrate:prod` local (roda nesta máquina; o que não roda local é o *build*). Hipótese a medir uma vez (Apêndice B): artefato de build arquivado + deploy local.

### 6.5 Perfil Site
`main` → produção via Workers Builds; PR → preview; zero workflows no GitHub; zero segredos no GitHub. Sem portão enquanto não houver migração de schema. Enquadramento por inventário (§7.4).

## 7. Roteiros de execução

### 7.1 Fundação — EXECUTADA em 01/11 (PRs odontobox#118, stagent#59, conecta#52)
`ci.yml` consolidado (sem builds; gitleaks com push; lint de migração; GC de preview com token dedicado); vocabulário `:prod` unificado; smoke portado para a Odontobox (rota `/api/_internal/identity`); `APP_SLUG`/`APP_ENV` declarados na Odontobox (sentinelas conferidas antes); auditoria por `git ls-files` (347 falsos erros → 0); `NOME` desacoplado nos clones (Worker limpo em produção, recursos com prefixo de ambiente); `deploy.yml` (401) e `gitleaks.yml` removidos.

### 7.2 Corte — ordem OBRIGATÓRIA (apagar antes de provar = ficar sem migração)
1. (André) Confirmar **Workers Paid** no painel. 2. (André) Gravar as build vars da §6.2 nos 3 Workers. 3. PATCH dos deploy commands + GET conferindo a base de previews intocada. 4. **Prova com tráfego real**: push em `staging` dos clones e merge na Odontobox — log do build mostra `migrate-guarded` + `audit --strict` (+ smoke onde houver token). 5. Desabilitar `deploy-stg.yml`/`deploy-prod.yml`/`preview.yml`/`migrate.yml` via API (reversível) → observar 1 ciclo → PR apagando. 6. `gh secret delete` de todos os segredos de deploy/runtime nos 3 repos (fica só o par do GC de preview e, transitoriamente, `NEON_API_KEY` da Odontobox) → rotação (Apêndice C). **Conferências pedidas pelo André:** todos os Workers ligados ao repositório GitHub com os comandos da §6.2; nenhum segredo de runtime restante no GitHub.
7. **Trava anti-regressão:** desativar GitHub Actions para novos workflows de deploy? Não existe trava técnica no plano Free — a regra fica escrita aqui: *workflow novo com segredo de deploy é regressão deste modelo.*

### 7.3 Odontobox-stg (depois; roteiro pronto)
Branch `staging` no git; `DEPLOY_ENV` introduzido no config (NOME: `odontobox` em produção, `odontobox-stg` em stg — produção **não muda de nome**; recursos novos `odontobox-stg-*`); buckets stg; Worker `odontobox-stg` ← `staging` com os comandos da §6.2; sentinela `odontobox/stg` já existe na branch staging do Neon; decisão aberta: Evolution-stg na VPS de 1 GB **ou** homolog sem canal. Ao entrar no fluxo: matar o job `banco` do CI + `NEON_API_KEY`, e repontar o preview para o banco de staging (hoje aponta para produção).

### 7.4 Go-live dos clones e sites
Go-live: Fase 12 (arquivo 13) já alinhada a este modelo — Workers `stagent`/`conecta` nascem do primeiro build com os comandos da §6.2; segredos de produção = André.

**Inventário dos sites (medido 01/11).** Nenhum dos 4 Workers de site está ligado ao Workers Builds hoje — cada um publica por um caminho diferente, e três dos quatro caminhos têm defeito:

- **venn360.com** — Next/vinext, Worker `venn360`. Último deploy 24/10 por `cf` CLI manual; zero workflows, zero segredos no GitHub. Defeito: o build do vinext não roda nesta máquina, então **não existe caminho reprodutível de deploy** — publicar depende de onde quer que o deploy de 24/10 tenha rodado. Enquadrar primeiro.
- **janainaleiteadv** — Next/vinext, Worker `janainaleiteadv`, D1. Deploy por GitHub Actions (`deploy.yml`, push em `main`) com `CLOUDFLARE_API_TOKEN` no GitHub — exatamente o padrão que este modelo elimina (e refém da cota: era o único caminho). **Resposta à pergunta do D1:** uma única migração (`0001_init`), gerada por `prisma migrate diff` e aplicada à mão na criação; o deploy não migra nada. Sem migração recorrente ⇒ sem portão, regra do Quadro 2 escrita. O `infra-zona.mjs` (vigia de zona, read-only) passa a rodar no CI de PR, sem token de deploy.
- **advogadamohs** — Astro, Worker `advogadamohs`. Deploy por `wrangler` local (Astro builda em macOS 12.6); zero GitHub. Funciona, mas é "só desta máquina".
- **visuallawdigital** — Astro, Worker `visuallawdigital`, **Neon** (schema versionado em `db/schema.sql`, aplicado à mão). O commit 7ae13c4 tirou o deploy do GitHub Actions *anunciando* Workers Builds, mas a conexão nunca foi feita — e o run de 31/10 morreu em 3 s no bloqueio de cota, provando que site também ficava refém. Hoje publica por `wrangler` local; o deploy de 01/11 16:42 saiu **antes do push** (o ar ficou na frente do git — a deriva que o modelo proíbe). Os segredos `CLOUDFLARE_*` de 25/10 continuam no GitHub sem workflow que os use: apagar e rotacionar (Apêndice C).

**Enquadramento (perfil §6.5, os 4):** ligar cada Worker ao repositório no Workers Builds — build `npm run build` (Astro) / `npm run build:vinext` (vinext), deploy `npx wrangler deploy` / `npm run deploy:vinext` — branch `main`, preview por PR; apagar `deploy.yml` e os segredos do janainaleiteadv e do visuallawdigital; depois disso, deploy local vira exceção, não rotina. Sem portão em nenhum site enquanto a migração de schema não virar rotina (hoje: zero sites migram no deploy).

## 8. Glossário
- **Portão**: `migrate-guarded` (migração que aborta se a sentinela do banco não for a esperada) + `audit:isolation --strict` (reprova referência a recurso de outro app). Roda antes do publish, no deploy command.
- **Sentinela**: linha única na tabela `app_identity` do banco (`slug`, `environment`) — a identidade do banco, conferida pela migração e pelo runtime.
- **vinext**: adaptador que compila o app Next.js para o runtime Workers (workerd) da Cloudflare. O build dele não roda em macOS < 13.5.
- **Clones**: Stagent e Conecta — derivados do código da Odontobox (vocabulário próprio: paciente→cliente etc.).
- **Smoke de identidade**: `scripts/smoke-identity.mjs` — após o deploy, confere pela rota de identidade que o ambiente publicado aponta para o banco/Evolution/buckets do próprio app.
- **Manifesto**: `infra/manifest.json` — o que cada ambiente DEVE usar (hosts, Neon, filas, buckets).
- **Workers Builds**: CI/CD da Cloudflare ligado ao repositório GitHub; constrói previews por PR e publica no push da branch vigiada.
- **Fase N**: arquivos `infra/runbook/NN-fase-*.md` deste diretório.

## Apêndice A — Fatos medidos (01/11/2026, salvo datado)
1. Outubro, GitHub Actions (wall-clock, não minuto faturado): odontobox ~2.770 min (preview 1.286 · checks 780 · deploy 426 · gitleaks 263), clones ~150 min cada. Bloqueio de billing 29–31/10: 414 runs mortos em <9 s.
2. 01/11 03:14–03:17: GH `deploy-stg.yml` e Workers Builds publicaram o MESMO Worker em sequência (dois oleodutos ativos).
3. `deploy.yml` da Odontobox: `401 Unauthorized / cf auth login` — credencial, não cota.
4. Proteção de branch: 403 "Upgrade to GitHub Pro" nos 6 endpoints (3 repos × main/staging).
5. `audit:isolation --strict` na Odontobox local: 347 erros, todos em `.claude/worktrees` e arquivos não rastreados; 0 após varrer por `git ls-files`.
6. Workers existentes antes do go-live: `odontobox`, `stagent-stg`, `conecta-stg`. Buckets `stagent-prod-*`/`conecta-prod-*` criados em 27/10.
7. Sentinelas conferidas por SQL: `odontobox/production` (29/10 e 01/11), `odontobox/stg` (29/10), `stagent/production`, `conecta/production` (29/10).
8. Preview não aceita `triggers` (medido 21/10) — "o preview serve para olhar tela, não para processar trabalho".
9. Rota de identidade: Odontobox `/api/_internal/identity` (underscore); clones `/api/internal/identity`.
10. Sites: nenhum dos 4 Workers ligado ao Workers Builds; fontes do último deploy — `venn360` cf_cli 24/10, `janainaleiteadv` GH Actions 19/10, `advogadamohs` wrangler 18/10, `visuallawdigital` wrangler 01/11 16:42 **com commit ainda não enviado ao remoto**. Run de deploy do visuallaw em 31/10 morto em 3 s pelo bloqueio de cota.

## Apêndice B — Pendências de verificação (cada uma com dono)
- [ ] Plano Workers **Paid** confirmado no painel (André; a API de billing recusa o escopo OAuth desta sessão). Evidência indireta: 9 filas/app, Queues é pago.
- [ ] Duração real de um build no Workers Builds (ler de `/builds/.../builds` após a fase 7.2) — substituir a estimativa de 6–8 min.
- [ ] Composição dos ~US$ 12/mês atuais do GitHub (André).
- [x] janainaleiteadv: D1 tem migrações próprias? **Respondido em 01/11 (§7.4):** uma, aplicada à mão na criação; o deploy não migra.
- [ ] venn360.com: de onde saiu o deploy de 24/10 (`cf` CLI, mas o vinext não builda nesta máquina)? Vira irrelevante quando o Worker for ligado ao Builds — mas conferir antes que não há outro caminho vivo (André).
- [ ] Hipótese do deploy local com artefato arquivado (§6.4) — medir UMA vez; a memória da máquina diz que o deploy do vinext falha localmente.

## Apêndice C — Segredos que viveram no GitHub (rotação)
Regra: apagar do GitHub **não desfaz** a exposição passada — todo segredo que viveu lá é tratado como potencialmente vazado e trocado, DEPOIS do corte (rotacionar antes quebraria o `deploy-stg.yml` ainda ativo). Donos e locais:
- 18 segredos de runtime × clone (lista exata: `gh secret list -R venn360/<repo>` na fase 7.2.6): trocar **no Worker** e, para `EVOLUTION_*`, também na VPS do app. Dono: André.
- Tokens Cloudflare do GH — dos 3 apps (o inválido da Odontobox incluído) **e dos sites** `janainaleiteadv` (em uso pelo `deploy.yml` até o corte) e `visuallawdigital` (órfão desde 25/10, sem workflow que o use): revogar na CF e apagar do GitHub; criar o token de emergência novo (gerenciador de senhas) e o `CLOUDFLARE_PREVIEW_GC_TOKEN` (escopo: previews).
- `NEON_API_KEY` (Odontobox): fica até o job `banco` morrer (§7.3); rotacionar ao removê-lo.
