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

---

## Estado da implementação — 2026-10-21

### O portão de compatibilidade passou

`npx vinext check`: **98% compatível, zero problemas.**

| Dimensão | Resultado |
| --- | --- |
| Imports de `next/*` | **7/7** suportados — inclusive `next/server` em 110 arquivos |
| Configuração | 3/4 — o parcial é `rules` do turbopack, e a config do projeto é `turbopack: {}` vazia |
| Bibliotecas | **7/7** — ele reconhece `better-auth` e `prisma` com driver adapters por nome |
| Estrutura | 27 páginas, 2 layouts, 108 rotas, todas mapeadas |

### As quatro decisões do `vinext init`, e o que as fundamentou

O `init` exige quatro escolhas com implicação de custo. Nenhuma foi tomada pelo
padrão — foram medidas no código:

| Escolha | Valor | Fundamento medido |
| --- | --- | --- |
| `--cdn-cache` | **`none`** | **131 rotas dinâmicas contra 4 estáticas**: é painel autenticado. E zero uso de `revalidate`, `revalidatePath` ou `revalidateTag` — não há o que cachear. Cachear página autenticada é como o dado de uma clínica chega a outra, e a auditoria encontrou CVEs de envenenamento de cache no Next exatamente nessa superfície |
| `--data-cache` | **`none`** | zero uso de `fetch` com `next: { revalidate }` e zero `unstable_cache` |
| `--image-optimization` | **`none`** | `next/image` em 3 componentes, com logo e avatar. A API de otimização foi o vetor de **dois RCE críticos** e um SSRF (ver auditoria §1), e `cloudflare-images` é produto pago |

### Wrangler saiu, `cloudflare.config.ts` entrou

O `vinext init` recusa substituir um `wrangler.jsonc` existente e pede
`cloudflare.config.ts`, que é a forma atual. O trabalho não se perdeu: bindings,
políticas de retentativa e crons transferiram, com os comentários.

E a configuração em TypeScript é **melhor** por dois motivos concretos:

1. **Os tipos de `cf/config` verificam a configuração.** Binding malformado,
   nome de fila inexistente ou export de Durable Object que a entrada não declara
   reprovam no `typecheck:cloudflare`. É a única verificação possível desse
   código sem publicar.
2. **A duplicação dos crons deixou de existir.** O JSON repetia os padrões que a
   agenda gerava; o TypeScript **chama** `cronsParaWrangler()`. Não há duas
   listas para divergir — e a guarda do teste mudou de forma: agora confere que
   a chamada está lá e que não há horário literal escrito à mão.

### Os quatro workflows

| Arquivo | Dispara | Portão |
| --- | --- | --- |
| `checks.yml` | PR e push na branch de migração | — |
| `preview.yml` | PR (não de fork) | environment `preview` |
| `deploy.yml` | push em `main` | environment `production` **com revisor obrigatório** |
| `migrate.yml` | **manual**, com confirmação digitada | environment escolhido |

Decisões que valem explicar:

- **A aprovação de produção não está no YAML.** Ela vem do GitHub Environment
  `production` configurado com revisor obrigatório — de propósito: um portão que
  mora no YAML pode ser removido no mesmo PR que o atravessa.
- **Migração é workflow próprio e manual.** Alterar schema não acontece como
  efeito colateral de um merge: a reversão de uma migração é diferente da de um
  deploy, e misturar as duas tira a possibilidade de reverter uma sem a outra.
  Tem duas trancas — o Environment e uma confirmação digitada, porque o menu tem
  `staging` como padrão e um clique distraído não deve aplicar nada.
- **PR de fork não publica preview.** Fork não recebe segredo, e publicar código
  de terceiro com a credencial da conta é o caminho clássico para comprometer
  uma conta de CI.
- **Uma branch do Neon por execução de CI**, criada e apagada no mesmo job
  (`if: always()` na remoção). Compartilhar uma branch faria dois PRs se
  atropelarem — `check:filas` apaga chaves de idempotência por fila, o que
  varreria o dado do outro. A string de conexão é mascarada com `::add-mask::`,
  que a esconde de qualquer linha de log, inclusive das que um passo futuro
  imprimir por descuido.
- **`npm run build:vinext` no CI é a verificação que não existe localmente.**
  `vite build` instancia Miniflare e o `workerd` exige macOS 13.5+ — na máquina
  de desenvolvimento ele falha ao carregar a configuração, antes de compilar.
  Aquela linha do workflow é o primeiro lugar onde o Worker é de fato construído.

> **As versões das actions foram conferidas, não presumidas.** Eu havia escrito
> `checkout@v5`, `setup-node@v5` e `github-script@v8`; as atuais são **v7, v7 e
> v9**. Teria sido falha de CI na primeira execução.

### O que falta configurar no GitHub

Nada disto é código — é configuração de repositório, e precisa da mão do André:

- [ ] Environment **`production`** com revisor obrigatório
- [ ] Environment **`preview`** e **`staging`**
- [ ] Segredos: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY`,
      `DATABASE_URL_DIRECT` (por ambiente)
- [ ] Proteção de `main`: PR obrigatório, checks obrigatórios, sem `force-push`
- [ ] Confirmar que PR de fork não recebe segredo (é o padrão da plataforma)
