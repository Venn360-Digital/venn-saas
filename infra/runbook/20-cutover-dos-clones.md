# 20 — Cutover dos clones para o monorepo

Como apontar `stagent` e `conecta` (produção e homologação) para este
repositório. Escrito em 17/11/2026, depois de o odontobox já servir produção
daqui e de os seis bancos convergirem.

Os quatro Workers ainda apontam para `Venn360-Digital/stagent360` e
`Venn360-Digital/conecta360`. O código dos dois apps **já está aqui** e compila:
`pnpm typecheck` roda `--filter "./apps/*"` e cobre os três.

---

## 0. A armadilha que custaria um ciclo de build

Os comandos dos quatro Workers são hoje **byte-idênticos** aos do odontobox:

```
build:  npx prisma generate && npm run typecheck && npm run build:prod
deploy: npm run portao:prod && npm run deploy:prod && npm run smoke:prod
```

No monorepo esses scripts da raiz são **do primeiro app**: `deploy:prod` é
`pnpm --filter @venn/odontobox360`. Repontar o repositório sem trocar os
comandos faria o Worker do stagent **buildar e publicar o app do odontobox**.

A rede existe e é a sentinela: `portao:prod` roda
`migrate-guarded --expect-slug odontobox` contra o banco do stagent, lê
`app_identity`, acha `stagent` e ABORTA antes de qualquer DDL. O
`smoke-identity` cobra o mesmo depois. Falha alto, não silencioso — mas é um
ciclo perdido e um susto evitável.

---

## 1. Banco: alinhar os checksums (antes de repontar)

`conecta` e `stagent` têm **9 checksums divergentes** no `_prisma_migrations`,
a mesma lista nos quatro bancos, porque vieram de repositórios próprios. O
`prisma migrate deploy` RECUSA o banco nessa condição.

Por que alinhar é factual, e não remendo: dos nove arquivos, **oito divergem só
na prosa dos comentários** (zero linha de SQL) e o nono,
`degenericizar_agenda`, difere em 11 linhas que são **exatamente** as que criavam
as três views de compatibilidade — removidas em 17/11. Com elas fora, o efeito
das duas versões converge. Prova independente: tabelas, colunas (com DEFAULT) e
os 232 índices são idênticos nos três bancos; conecta e stagent são
byte-idênticos nos três eixos.

Nos **quatro** bancos dos clones, um por vez:

```bash
# relatório primeiro — não escreve nada
set -a; . ~/.venn360-secrets/conecta/neon-staging.env; set +a
node scripts/alinhar-checksums.mjs

# e então, nomeando o banco em voz alta
node scripts/alinhar-checksums.mjs --aplicar --confirmo conecta/stg
```

Repetir com `conecta/neon-production.env` → `--confirmo conecta/production`, e
o mesmo par para `stagent`.

O script lê `app_identity` e aborta se o banco não for o nomeado. Nunca insere,
nunca apaga, nunca toca linha fora do repositório nem linha com
`rolled_back_at`.

## 2. Banco: a pendente que falha nos clones

Os quatro bancos têm 2 migrações pendentes. Uma delas,
`20261116180000_comentarios_da_renomeacao`, faz `COMMENT ON VIEW specialists` —
view que **só existiu no odontobox**. Lá ela falha, e falharia depois de o build
inteiro rodar. O relatório do passo 1 aponta isso com os nomes das relações
ausentes.

Marcar como aplicada sem rodar, nos quatro bancos:

```bash
pnpm --filter @venn/db exec prisma migrate resolve \
  --applied 20261116180000_comentarios_da_renomeacao
```

Não se perde nada: a migração seguinte (`20261117010000`) reescreve os três
comentários de tabela, e os comentários das views não fazem sentido onde as
views não existem.

A outra pendente, `20261117010000_remover_views_de_compatibilidade`, usa
`DROP VIEW IF EXISTS` — nos clones é no-op, e os três `COMMENT ON TABLE` se
aplicam normalmente. Ela **deve** rodar.

## 3. Painel: repontar cada Worker

**Editar a configuração de BUILD é seguro** — não republica o Worker, logo não
cria o `last_deployed_from: "dash"` que trancou o publish da homologação em
16/11 (ver runbook 19 e o plano). Só edição de *settings* do Worker faz isso.

### Essencial — repositório e os dois comandos

| campo | valor |
|---|---|
| Repositório | `Venn360-Digital/venn-saas` |
| Branch | `main` (produção) · `staging` (homologação) |
| Root directory | `/` — já é, nos seis |

**stagent, produção**

```
npx prisma generate && npm run typecheck && npm run build:prod:stagent
npm run portao:prod:stagent && npm run deploy:prod:stagent && npm run smoke:prod:stagent
```

**stagent, homologação**

```
npx prisma generate && npm run typecheck && npm run build:stg:stagent
npm run portao:stg:stagent && npm run deploy:stg:stagent && npm run smoke:stg:stagent
```

**conecta, produção**

```
npx prisma generate && npm run typecheck && npm run build:prod:conecta
npm run portao:prod:conecta && npm run deploy:prod:conecta && npm run smoke:prod:conecta
```

**conecta, homologação**

```
npx prisma generate && npm run typecheck && npm run build:stg:conecta
npm run portao:stg:conecta && npm run deploy:stg:conecta && npm run smoke:stg:conecta
```

E o **preview** dos dois Workers de homologação:

```
npx prisma generate && npm run build:preview:stagent
npm run deploy:preview:stagent
```

(troque `stagent` por `conecta` no outro.)

### Variáveis de build: nada a fazer

Conferido pela API nos quatro: `DATABASE_URL_MIGRATOR` e `IDENTITY_TOKEN` já
estão lá como secret, mais `NEXT_PUBLIC_SUPPORT_EMAIL`,
`NEXT_PUBLIC_SUPPORT_WHATSAPP` e `NODE_VERSION=24`. Trocar o repositório **não
apaga as variáveis** — é o mesmo objeto de configuração de build.

Falta só `NEON_API_KEY` no lado **Preview** dos dois Workers de homologação, e
ela é opcional: sem ela o `ci-neon.mjs` PULA a prova contra o banco com um aviso
alto e sai com 0. Vale acrescentar depois, não antes.

### Watch paths: opcional, e deliberadamente deixado para depois

Os seis estão em `path_includes: ["*"]`, que builda tudo a cada commit. É
**desperdício, não incorreção**: cada Worker roda o portão do seu app, e a
sentinela impede cruzamento. Estreitar é otimização; fazer isso no mesmo dia do
cutover é somar uma variável a um corte. Deixar para depois é a escolha certa.

Quando for:

```
includes: apps/<app>/**, packages/**, scripts/**, infra/**,
          pnpm-lock.yaml, package.json, pnpm-workspace.yaml, tsconfig.base.json
excludes: **/*.md
```

## 3.5. Apagar os previews órfãos — e os DOIS da branch `main`

Levantado em 17/11 pela API (`GET /builds/workers/{tag}/previews`), e nenhum
aparece na tela de Build:

| Worker | previews | o quê |
|---|---|---|
| `odontobox-stg` | 2 | **`main`** + `feat/exercicio-do-migrador` |
| `conecta-stg` | **17** | **`main`** + 16 branches do repositório ANTIGO |
| os outros quatro | 0 | — |

Todos com `auto_build = true`.

**Os dois de `main` são os que doem.** Um preview da branch `main` dispara a cada
merge em produção, roda os comandos de PREVIEW e reprova — foi exatamente isso
que pintou de vermelho todo merge em `main` no `odontobox-stg` em 17/11. Com o
`conecta-stg` repontado, o dele faria o mesmo, em dobro.

Check vermelho crônico ao lado dos quatro cutovers treina o olho a ignorar
justamente os builds que precisam ser lidos. **Apagar antes de repontar.**

Os outros 17 são de branches que não existem mais — resquício do repositório
antigo, e a mesma família dos "16 órfãos de namespace" que o plano já
registrava. Não disparam (a branch não existe), mas seguram recurso de preview.

No painel: Workers & Pages → o Worker → a lista de previews por branch. Pela
API, para conferir antes e depois:

```js
await cloudflare.request({ method: 'GET',
  path: `/accounts/${conta}/builds/workers/${script_tag}/previews?per_page=50` })
```

## 3.6. O que os três cutovers de staging ensinaram (18/11/2026)

Esta seção foi escrita DEPOIS de fazer os três. O que está acima era a previsão;
isto é a medição.

### Trocar o repositório não é editável — e a criação tem endpoint próprio

A Builds API só deixa trocar a **branch** por `PATCH`. Repositório exige
disconnect + nova conexão, e **a nova conexão é `POST /builds/workers` com
`script_tag` NO CORPO** — não `POST /builds/workers/{tag}`, que é o de
atualização. Errar isso deixa o Worker desconectado, servindo mas sem buildar.

Ferramenta que faz os dois casos: `~/.venn360-secrets/reconectar-worker.py`.
Conhece os quatro Workers dos clones, com os `build_token_uuid` capturados ANTES
do disconnect, e preserva `previews_enabled` (produção = `false`).

### `wrangler secret put` NÃO republica o script

Medido nos dois Workers: `last_deployed_from` ficou em `cf_cli` e o
`modified_on` continuou sendo o do deploy. **Gravar secret pelo wrangler é
seguro; pelo painel põe `dash` e tranca o publish** (ver runbook 19 e o plano).
Isso vale para toda rotação de credencial deste sistema.

### O disconnect limpa os previews

Os 17 previews órfãos do `conecta-stg` — inclusive o da branch `main`, que
reprovava todo merge em produção — foram embora com o disconnect. O passo 3.5
sai de graça quando se passa por aqui.

### `IDENTITY_TOKEN`: o cofre dos clones nunca foi o valor vivo

Sondados os seis ambientes: o do odontobox casa nos dois, o dos clones em
nenhum. O disconnect apaga a variável de build que casava, então a divergência
aparece como `401` no smoke. Rotação em três lugares, nesta ordem:

```
1. gravar-chave.sh <app> <amb> IDENTITY_TOKEN     cofre
2. reconectar-worker.py <worker> aplicar          variável de build (PATCH)
3. copiar.sh + wrangler secret put                runtime — não trava
```

**Em produção, rotacionar ANTES do disconnect**: o primeiro build nasce verde em
vez de reprovar no smoke.

### 503 no smoke é "ainda não"; 401 é "não casa"

O smoke roda logo depois do `cf deploy` e pode pegar a janela em que o binding
da versão nova ainda não está vivo — dá `503`, que na rota tem uma causa só
(`APP().identityToken` vazio). Hoje o smoke espera 6 × 5 s no 503 e em erro de
rede, e **reprova na primeira no 401**, que é credencial errada de verdade.

### Secret declarado e não gravado REPROVA o deploy; gravado e não declarado é REMOVIDO

As duas metades da mesma regra declarativa do `cloudflare.config.ts`. O
`stagent-stg` reprovou no primeiro deploy do monorepo porque o config declarava
`PLATFORM_ASAAS_CLIENT_ID/SECRET` que o Worker nunca teve — declaração herdada
do molde na Fase 3. O conserto foi retirar a declaração (o stagent cobra por
Stripe), e os valores inertes saem sozinhos no deploy seguinte.

**Antes de cada cutover, comparar o conjunto de secrets do Worker com o que o
config do app declara.** Pela API:

```js
GET /accounts/{conta}/workers/scripts/{nome}/settings   → bindings[type=secret_text]
```

Medido em 18/11: os três de staging com 22 cada; `stagent` produção com 20 — e
os dois que faltam são justamente os que saíram do config.

### A ordem do banco depende de onde o Worker aponta

Alinhar checksums ANTES do disconnect tira a capacidade de publicar do
repositório ANTIGO também — em produção, isso é perder a saída de emergência.
Então: disconnect → reconectar → alinhar + resolve → build.

## 3.7. ⚠️ PROMOVER `main` ANTES de repontar produção

Os Workers de produção apontam para a branch **`main`**. Repontar um deles para
`venn-saas` faz o primeiro build publicar **o que `main` tiver naquele
momento** — não o que está em `staging`.

Medido em 18/11, com `main` 7 commits atrás: dois desses commits são
pré-requisito do cutover de produção.

| commit | o que acontece sem ele |
|---|---|
| Asaas sai do config do stagent | o primeiro build do `stagent` produção **reprova**: secret declarado e não gravado |
| smoke espera no 503 | vermelho em falso logo depois do deploy |

Então a ordem é:

```
1. promover staging → main   (e conferir produção do primeiro app)
2. rotacionar IDENTITY_TOKEN de produção
3. disconnect + reconectar-worker.py
4. alinhar checksums + resolve
5. o build de main publica
```

Inverter 1 e 3 custa um ciclo no melhor caso e, no `stagent`, reprova de
primeira. Antes de promover, conferir que a promoção não leva migração nova:

```bash
git diff --name-only origin/main..origin/staging -- packages/db/prisma/migrations/
```

Vazio = o deploy de produção é no-op de banco, e o risco cai para o código.

## 4. Verificar

Linha de base medida em 17/11 09:16, antes de qualquer cutover — os quatro
ambientes saudáveis:

| | `/api/health` | `/login` | 4 rotas de vendas/agenda | `widget.js` |
|---|---|---|---|---|
| conecta produção | ok, `database: ok` | 200 | 307 | 16.616 B |
| stagent produção | ok, `database: ok` | 200 | 307 | 16.616 B |
| conecta homologação | ok, `database: ok` | 200 | 307 | 16.624 B |
| stagent homologação | ok, `database: ok` | 200 | 307 | 16.624 B |

Depois de cada cutover, repetir o quadro e conferir no banco: contagem de
migrações (deve subir 2), dado vivo inalterado, e **uma tela autenticada aberta
por uma pessoa** — é a exigência que o plano fixou e que nenhum `curl` substitui.

## 5. Ordem recomendada

1. `conecta` homologação — o de menor consequência
2. `conecta` produção
3. `stagent` homologação
4. `stagent` produção

A janela de observação de 3 dias foi dispensada pelo André em 17/11. O que a
substitui é a verificação autenticada humana entre cada par.

## 6. Rollback

Reapontar o Worker para o repositório antigo, que fica intacto. Os comandos
antigos (`build:prod`, `portao:prod`, …) existem lá e funcionam. Por isso os
repos de `stagent360` e `conecta360` **não são arquivados** até cada app
acumular um ciclo estável servindo do monorepo.

**Atenção: reapontar o Worker NÃO desfaz o passo 1.** O banco passa a guardar os
checksums deste repositório, e o `migrate deploy` do repositório ANTIGO
reclamaria dos mesmos nove, agora ao contrário. O rollback do Worker sozinho
deixaria o app antigo sem conseguir publicar.

Por isso o `--aplicar` grava, antes de escrever, um retrato
`alinhar-checksums.<slug>-<env>.<timestamp>.json` no diretório onde foi rodado,
com os checksums de antes e o SQL de `desfazer` pronto. **Guarde os quatro
arquivos.** Desfazer é rodar o SQL que eles carregam, e aí o repositório antigo
volta a publicar.
