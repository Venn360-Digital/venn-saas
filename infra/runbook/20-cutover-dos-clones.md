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
