# Relatório — Fase 01 (Inventário e fingerprint da Odontobox360)

**Data:** 2026-10-27 · **Branch:** `chore/dup-inventario` · **Modo:** somente leitura (exceção: projeto Neon temporário `tmp-migration-check`).

## Resumo executivo

A Odontobox360 é um CRM/atendimento multicanal (WhatsApp QR via Evolution Go, WhatsApp Cloud e Instagram oficiais via Meta Graph, agentes de IA com RAG, agenda, vendas, broadcast, cobrança Asaas) em **Next 16 + vinext + Cloudflare Workers + Neon PG18 + R2 + Email Sending**, multi-tenant por Better Auth (só e-mail/senha, feito à mão, sem plugins). A arquitetura odontológica é **de superfície** (rótulos e um setor hardcoded), o núcleo é genérico. O Worker `odontobox` está no ar em `odontobox.venn360.com` (custom domain ativo), com 3 Durable Objects, 9 filas e 12 crons. O banco Neon tem produção e staging como branches do mesmo projeto. O WhatsApp QR roda numa VPS Vultr dedicada (4 GB, São Paulo) só com Evolution Go + Postgres + Tunnel, 1 número pareado e tráfego real. As migrations são **100% reprodutíveis** (schema do zero idêntico a produção). O histórico git está **limpo** de segredos. O maior débito é a **ausência de um staging isolado de verdade** — previews reusam Worker, filas, DO, R2, secrets, Evolution e e-mail de produção. As zonas `.com.br` dos novos produtos não existem (nem existirão): os novos sistemas serão subdomínios de `venn360.com`.

## Lacunas de staging (seção H), por severidade

**Crítica (recurso compartilhado prod×stg):**
- **Sem Worker de staging** — só previews efêmeros `pr-N` em `workers.dev`.
- **R2 compartilhado** — não há buckets de staging; previews leem/escrevem `odontobox-public`/`-private` de produção.
- **Filas e Durable Objects compartilhados** — previews (`pr-10`…`pr-18`) são **produtores nas filas de produção** `odontobox-*`.
- **Secrets compartilhados** — preview usa o mesmo Worker/escopo de produção.
- **Evolution compartilhado** — um só contêiner no VPS; não há Evolution de staging.

**Alta:**
- **Branch Neon `staging` atrás de produção** — faltam as tabelas de marketing/broadcast (`migrate deploy` recente não aplicado em staging).
- **E-mail** — staging usaria o remetente real `mail.venn360.com` (envia a clientes reais).
- **Credenciais Google/Meta/Asaas** — leem as mesmas linhas de plataforma.

**Média:**
- **Access `evo-odontobox.venn360.com`** compartilhado.

## Resultado das migrations (seção E)
**IDÊNTICO.** 48 migrations aplicadas do zero no `tmp-migration-check` (PG 18, sa-east-1) sem erro; schema `public` idêntico a produção (tabelas 59, colunas/índices/constraints com md5 batendo). Detalhe em `infra/inventory/schema-diff.md`. Pode duplicar. Sem `db push`, sem seeds, sem SQL fora das migrations.

## Achados de segredos (seção B)
`gitleaks` em 630 commits: **6 achados, todos falsos positivos** (literais de teste em `scripts/check-auth.ts` e uma chave de `localStorage` em `useSoundEnabled.ts`). Nenhuma credencial viva no histórico; o `.env` nunca foi commitado. **Nada a rotacionar antes do espelhamento.**

## Capacidade da VPS (seção F7)
VPS `odontobox` (Vultr `vhf-2c-4gb`, 2 vCPU / 4 GB / 128 GB, São Paulo). Uso atual ~134 MiB de 3.3 GiB; disco 12%. Para +4 Evolution Go (Stagent/Conecta × prod/stg): **cabe com folga pelo uso real (~28 MiB/container)**, mas **não cabe pela regra dos 25% de folga se mantidos os limites de 512 MiB/container** (faltariam ~0.6–0.9 GiB). Decisão do André: subir o plano, baixar o limite por container, ou instância compartilhada.

## Evolution — necessidade da Fase 04
**Fase 04 necessária: NÃO.** Já roda **Evolution Go 0.7.2** (whatsmeow) na VPS, sem nenhum Evolution API v2 Node em uso (o v2 foi aposentado no código e não há contêiner dele). Não há migração API→Go nem API ociosa a remover. A Fase 04 pode ser pulada para a Odontobox. (A montagem do Evolution Go dos **novos** apps é a Fase 08.)

## Zonas `stagent.com.br` / `conecta.com.br`
**Não existem — e nunca existiram** (confirmado na conta Cloudflare Venn360 e por André em 2026-10-27). Os novos sistemas são **subdomínios de `venn360.com`**: `stagent.venn360.com`, `conecta.venn360.com`, com Evolution em `evo-stagent.venn360.com` / `evo-conecta.venn360.com` (padrão já usado por `evo-odontobox.venn360.com`). A tabela de nomes do `01-REGRAS-GLOBAIS.md` (que previa `wa.{slug}.com.br`) está **superada**; a "Atenção 2" não se aplica.

## Outros achados (para a Fase 02)
1. **Segredo órfão `RESEND_API_KEY`** no Worker `odontobox` (não declarado no `cloudflare.config.ts`; Resend desativado) → remover e retirar a chave no Resend.
2. **12 cron triggers ativos vs 13 declarados** no código → conferir qual cron não registrou.
3. **Schema `neon_auth` (9 tabelas)** no banco = provisionamento do Neon Auth **não usado** (o app tem Better Auth próprio em `public`) → candidato a limpeza.
4. **Better Auth sem `cookiePrefix`/`crossSubDomainCookies`** definidos (defaults da lib). Hoje o Odontobox é o único host; quando `stagent`/`conecta` entrarem sob `venn360.com`, cookie com `Domain` herdado poderia vazar sessão entre produtos. A trava **T5** (cookies host-only + `cookiePrefix={slug}`) é da Fase 03/10 — registrar que o Odontobox **também** precisa dela antes de haver vizinhos sob o apex.
5. **VPS sem backup nem snapshot** — credenciais de aparelho do WhatsApp (`evogo_auth`) só vivem no host. Antes de qualquer mudança na VPS (R7) é obrigatório snapshot; recomendável habilitar backup agora.
6. **Sem role read-only no Neon** (D4 pede uma) — o dump foi gerado do projeto temporário (idêntico a produção) para não usar credencial de produção. Criar role read-only na Fase 02.
7. **Regras WAF/rate-limit são por path, não por hostname** — hoje aceitável (zona só com Odontobox e sites institucionais), mas as regras **alcançam** os novos subdomínios; os novos apps devem filtrar por `http.host` (R4) e convém rever as atuais quando `stagent`/`conecta` entrarem.
8. **`main` e `staging` não protegidas no Neon**; branch de produção sem proteção.

## Perguntas ao André
1. **Capacidade da VPS (F7):** manter 4 GB e baixar o limite por container, subir o plano, ou uma instância Evolution compartilhada entre apps? (afeta Fase 08)
2. **`tmp-migration-check` (`green-morning-27061854`):** confirmo o apagamento? (R6 — comando destrutivo, aguardando "confirmo")
3. **IDs Google/Meta** (client ID, project ID, App ID) vivem em Vault/DB e não são descobríveis por leitura — quando a Fase 09 precisar, você passa, ou autoriza eu lê-los do banco/Vault?
4. Confirmar que **pular a Fase 04** para a Odontobox está correto (já é Evolution Go puro).

## Conformidade com os critérios de saída
- [x] Nenhuma escrita em Cloudflare, Neon (exceto `tmp-migration-check`), VPS ou GitHub (exceto branch/PR).
- [x] Fingerprint com ≥1 entrada por categoria aplicável (Turnstile vazio = não existe; Google/Meta IDs em Vault/DB, registrados como desconhecidos).
- [x] Nenhum valor de segredo em nenhum arquivo.
- [x] Relatório gerado. **PARADO, aguardando "OK fase 01".**
