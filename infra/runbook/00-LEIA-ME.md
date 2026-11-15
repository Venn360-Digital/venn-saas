# Runbook — Duplicação Odontobox360 → Stagent360 e Conecta360

Pacote de prompts para o **Claude Code**: cada fase é um arquivo e termina em um ponto de parada. Nada avança sem o seu "OK fase NN".

## Ordem de execução

| # | Arquivo | Onde | Altera o quê |
|---|---|---|---|
| — | `01-REGRAS-GLOBAIS.md` | todas as fases | — (lido antes de cada fase) |
| 01 | `02-fase-01-inventario-odontobox.md` | repo Odontobox | nada (somente leitura) |
| 02 | `03-fase-02-saneamento-odontobox.md` | repo Odontobox | staging da Odontobox; produção só com "OK produção" |
| 03 | `04-fase-03-parametrizacao-identidade.md` | repo Odontobox | código (identidade + travas); produção só com "OK produção" |
| 04 | `05-fase-04-evolution-go-odontobox.md` | repo Odontobox + VPS | condicional: migra/limpa Evolution API → Go |
| 05 | `06-fase-05-clonagem-rebranding.md` | repo novo | cria `venn360/stagent360` |
| 06 | `07-fase-06-neon.md` | repo novo | projeto Neon novo |
| 07 | `08-fase-07-cloudflare.md` | repo novo | recursos Cloudflare novos |
| 08 | `09-fase-08-vps-evolution-go.md` | VPS existente | 2 containers novos |
| 09 | `10-fase-09-integracoes.md` | consoles Google/Meta | projetos/apps novos |
| 10 | `11-fase-10-cicd-secrets-travas.md` | repo novo | secrets, CI, 1º deploy em homologação |
| 11 | `12-fase-11-testes-isolamento.md` | homologação | nada (testes) |
| 12 | `13-fase-12-go-live.md` | produção do app novo | go-live |
| 13 | `14-fase-13-retrospectiva-e-conecta360.md` | — | retro + repete 05→12 para o Conecta360 |
| — | `15-arquitetura-cicd-github-workers-builds.md` | **a arquitetura definitiva de CI/CD** (GitHub = código/PR/verificação; Workers Builds = build/preview/deploy com portão). Corrige e supera o que as Fases 10 e 12 diziam sobre deploy | todos os projetos |
| — | `16-emergencia-deploy.md` | deploy de emergência com o Workers Builds fora do ar (YAML pronto + token fora do GitHub; code-only) | emergência |

**Em paralelo:** comece a **Fase 09, Parte A** (criar projetos Google e apps Meta e pedir verificações) logo depois da Fase 01. As aprovações levam semanas e são o caminho crítico.

## Como usar

1. Copie esta pasta para dentro do repositório da Odontobox, em `infra/runbook/`. Ela vai junto para os repositórios clonados, e os arquivos ficam ignorados pela auditoria.
2. No Claude Code, dentro do repositório certo, use:
   > Leia `infra/runbook/01-REGRAS-GLOBAIS.md` e execute `infra/runbook/02-fase-01-inventario-odontobox.md`. Siga as regras à risca e pare no checkpoint.
3. Leia o relatório `infra/reports/<slug>/fase-NN.md`, responda às perguntas e só então diga "OK fase NN".
4. Na Fase 05, preencha o bloco "Variáveis desta execução" antes de colar o prompt.

## Pré-requisitos (prepare antes da Fase 01)

- **Cloudflare:** um token **somente leitura** para o inventário e, depois, um token por app novo (`stagent-provisioning`, `stagent-ci`).
- **Neon:** MCP conectado e uma role read-only no banco da Odontobox (para o `pg_dump --schema-only`).
- **VPS:** usuário dedicado (não root, grupo `docker`, chave SSH) e acesso ao painel Vultr para snapshot. O MCP da Vultr é somente leitura.
- **GitHub:** `gh auth login` com acesso à org `venn360`.
- **Domínios:** zonas `stagent.com.br` e `conecta.com.br` na mesma conta Cloudflare, para os hostnames do Evolution.
- **Marca:** pasta com `logo.svg`, `logo-mono.svg`, `favicon.ico` e `og.png` de cada produto.

## Templates (`templates/`)

- `manifest.example.json`: modelo do `infra/manifest/<app>.json`, a fonte única de verdade dos recursos de cada app.
- `fingerprint.example.json`: modelo de `infra/fingerprints/<slug>.json`, os identificadores de um app, que viram lista proibida nos outros.
- `audit-isolation.mjs`: auditoria estática, sem dependências.
  - `node scripts/audit-isolation.mjs` aceita os placeholders `__FASE07__` (Fases 05–06).
  - `node scripts/audit-isolation.mjs --strict` não aceita placeholders (Fase 07 em diante e no CI).

## O que a auditoria detecta (testada)

- qualquer string, hostname, ID Cloudflare, bucket, endpoint Neon, container ou client ID de outro app, em qualquer arquivo ou nome de arquivo;
- ID no `wrangler.jsonc` que não está no manifesto;
- `env.stg` usando KV, bucket, queue ou hostname de `production`, e vice-versa;
- configuração raiz do wrangler (dev local) apontando para produção;
- `APP_SLUG` / `APP_ENV` errados por ambiente;
- placeholders esquecidos (modo `--strict`).

Termos do segmento (ex.: `odontograma`) geram **aviso**, não erro, para você decidir módulo a módulo.
