# 08 — GitHub, versionamento e CI/CD

## Repositório

`https://github.com/venn360/venn.odontobox360` é a fonte oficial. **Um
repositório por SaaS** — justificativa em [`00-open-decisions.md`](00-open-decisions.md) §3.

| Branch | Papel |
| --- | --- |
| `main` | **produção** |
| `migracao/cloudflare-neon` | esta migração |
| `fase-1-config-do-agente`, `feat/design-system-odontobox360`, `feat/workers-and-selfhost` | anteriores, não tocadas |

## Fluxo

```
branch → PR → checks → preview → revisão → merge em main → aprovação humana → produção
```

- **nunca** editar `main` direto;
- **nunca** `force-push`, nem reescrever histórico;
- commit local na branch de migração serve de checkpoint, depois de revisar o
  diff e rodar os testes;
- push, PR, merge e deploy seguem a política de autorização — por padrão, **não**
  sem aval explícito.

## Proteção de `main` — a configurar

- [ ] PR obrigatório, sem push direto
- [ ] checks obrigatórios: `typecheck`, `lint`, `check:cofre`, `check:widget`,
      `lint:colors`, `lint:workspace`, build
- [ ] `force-push` e exclusão bloqueados
- [ ] histórico linear

## CI: GitHub Actions + Wrangler, não Workers Builds

A escolha é forçada pelo ambiente, não por preferência:

> **`workerd` exige macOS 13.5+ e a máquina está em 12.7.6.** O build do vinext
> **só** roda em Linux. O CI não é conveniência, é o único lugar onde o artefato
> pode nascer.

Entre as duas opções:

| | Workers Builds | **GitHub Actions + Wrangler** |
| --- | --- | --- |
| Simplicidade | maior | menor |
| Controle de gate | limitado | **completo** |
| Rodar os 6 linters do projeto | ajuste | natural |
| Separar preview/produção com revisor | limitado | **GitHub Environments** |
| `prisma migrate deploy` no pipeline | difícil | natural |

**Decisão: GitHub Actions.** O projeto tem 6 verificadores próprios
(`lint-colors`, `lint-workspace`, `check-widget`, `check:cofre`, `typecheck`,
`eslint`) e precisa de `prisma generate` antes do build e de `migrate deploy`
como passo controlado. Isso é pipeline, não gatilho.

### Workflows

| Arquivo | Dispara | Faz |
| --- | --- | --- |
| `checks.yml` | PR, push na branch | `npm ci` → `prisma generate` → os 6 verificadores |
| `preview.yml` | PR | build vinext → deploy de preview → comenta a URL |
| `deploy.yml` | push em `main` | build → **environment `production` com revisor** → `wrangler deploy` |
| `migrate.yml` | manual | `prisma migrate deploy`, environment protegido |

`migrate.yml` separado e manual de propósito: migração de banco não deve
acontecer como efeito colateral de um merge.

## Secrets no pipeline

| Onde | Guarda |
| --- | --- |
| GitHub Environment `preview` | `CLOUDFLARE_API_TOKEN` com escopo de preview, `DATABASE_URL` de **staging** |
| GitHub Environment `production` | token de produção, `DATABASE_URL` de produção, **com revisor obrigatório** |
| Cloudflare Secrets | os segredos de execução (os 12 de `02-runbook.md` A.5) |

**Build de PR não pode alcançar secret de produção.** GitHub Environments com
revisor é o que garante isso — e PR de fork não recebe secret nenhum, por
padrão da plataforma. Confirmar esse padrão antes do primeiro PR externo.

**Nunca** em commit, log, issue ou artefato: `.env`, token, chave privada,
export de dados.

## Rollback

| Camada | Como |
| --- | --- |
| Worker | republicar a versão anterior (`wrangler rollback` ou deploy do commit anterior) |
| Banco | *instant restore* do Neon — **elevar a retenção para ≥ 24 h antes do corte** |
| DNS | voltar o registro; TTL baixado para 60 s ≥ 1 h antes |
| Código | `git revert`, nunca `force-push` |

## O que está bloqueado hoje

O MCP do GitHub **não conecta** (`400 Authorization header is badly formatted`).
Contorno em uso: `gh` CLI autenticado como `venn360`, escopos
`gist, read:org, repo, workflow` — suficiente para PR, checks e proteção de
branch.
