# FASE 01 — Inventário e fingerprint da Odontobox360 (SOMENTE LEITURA)

**Onde executar:** repositório da Odontobox (`~/Desktop/Projects/<repo-odontobox>`), branch nova `chore/dup-inventario` criada a partir de `main` atualizada.
**Modo:** somente leitura em TODOS os sistemas externos. As únicas escritas permitidas são arquivos novos em `infra/` nesta branch e um projeto Neon temporário SEPARADO (item E).
**Antes de começar:** leia `infra/runbook/01-REGRAS-GLOBAIS.md`.

---

## Objetivo

Produzir um retrato completo e verificável da Odontobox: código, Cloudflare, Neon, VPS e integrações. Esse retrato serve para:

1. saber exatamente o que precisa ser recriado em cada novo app;
2. gerar `infra/fingerprints/odontobox.json`, a lista de identificadores que NENHUM outro app pode referenciar;
3. apontar lacunas no staging atual da Odontobox, que serão corrigidas na Fase 02.

Se alguma ferramenta tiver credencial com permissão de escrita, use SOMENTE operações de leitura (list, get, describe, inspect, `SELECT`). Registre no relatório cada chamada externa feita.

---

## A. Código (repositório)

1. **Stack e versões:** Next.js, `@opennextjs/cloudflare`, wrangler, Node, Better Auth, ORM (Drizzle/Prisma/outro), driver Postgres e versão do Postgres esperada.
2. **Configuração wrangler** (`wrangler.jsonc`/`.toml`). Monte a tabela completa POR AMBIENTE (raiz, `env.*`) com:
   - `name` e rotas/custom domains;
   - vars;
   - TODOS os bindings: Hyperdrive, R2, KV, Queues (producer/consumer), Durable Objects (+ migrations), Workflows, `send_email`, Secrets Store, services, AI, Analytics Engine, assets;
   - triggers cron e compatibility date/flags.
3. **Variáveis de ambiente:** liste TODOS os nomes usados (`.env.example`, `.dev.vars*`, `process.env.*`, `env.*`, `getCloudflareContext`). Classifique cada uma em var pública, var de servidor ou secret, e diga por qual serviço é consumida. NUNCA imprima valores.
4. **Better Auth:**
   - provedores (e-mail/senha, Google, magic link, outros) e plugins (organization, admin, 2FA…);
   - `trustedOrigins`, `baseURL`, `advanced.cookiePrefix`, `crossSubDomainCookies`, `useSecureCookies`;
   - tabelas geradas.
5. **Migrations:** ferramenta, pasta, quantidade, se há `db push` ou SQL manual fora das migrations, scripts `package.json` relacionados e seeds existentes.
6. **Integrações no código:** liste cada host externo chamado (`fetch`, SDKs), cada endpoint de webhook recebido (path, método, origem, se valida assinatura) e o mecanismo de envio de e-mail.
7. **WhatsApp QR:** qual cliente o código usa (Evolution API v2 ou Evolution Go?), quais endpoints chama, quais eventos de webhook trata e como o app sabe a URL e a chave do Evolution.
8. **R2:** uso via binding ou via API S3 (presigned URLs?), pastas/prefixos e se há acesso público.
9. **Identidade hardcoded:** varra o repositório (ignorando `node_modules`, `.git`, builds) por:
   - `odontobox`, `odonto box`, `Odontobox360`, domínios da Odontobox;
   - e-mails, telefone, cores da marca, nomes de arquivos de logo;
   - textos de e-mail, metadados, PWA manifest, OG images e páginas legais.

   Liste arquivo:linha agrupado por categoria.
10. **Funcionalidades do segmento odontológico:** módulos, tabelas, seeds e telas específicos de odontologia (odontograma, procedimentos, convênios odontológicos…). Apenas liste. A decisão sobre o que vai para os novos apps é do André (Fase 05).
11. **CI/CD atual:** workflows GitHub, Workers Builds (painel) e scripts de deploy.

## B. Histórico Git

Rode `gitleaks detect --log-opts="--all"` (instale se faltar). Se não for possível, use `trufflehog git file://. --only-verified`.

Liste os achados SEM valores: tipo, arquivo, commit e data. Para cada achado, informe se a credencial ainda parece estar em uso, comparando o nome com as variáveis do item A3. Isso alimenta a Fase 02. O repositório será espelhado com histórico, então credenciais vivas no histórico precisam ser rotacionadas antes.

## C. Cloudflare (leitura)

Use o MCP da Cloudflare ou a API com token de leitura.

1. Conta (ID) e zonas relevantes: `venn360.com`, o domínio da Odontobox, `stagent.com.br` e `conecta.com.br`. **Informe se `stagent.com.br` e `conecta.com.br` existem como zonas nesta conta** (pré-requisito dos hostnames Evolution).
2. Plano de cada zona e limites de regras WAF/rate limiting. Informe quantas regras de cada tipo já estão em uso.
3. Modo SSL/TLS de cada zona (apenas informar; NÃO alterar).
4. Workers da Odontobox: nome, ambiente, bindings reais (via API, não só pelo arquivo), rotas, custom domains, crons, última versão implantada e se há Workers Builds conectado.
5. Hyperdrive (nome, ID, host de origem, caching), R2 (nome, CORS, custom domain, `r2.dev` público, lifecycle), KV, Queues, Durable Objects, D1 (se houver) e Secrets Store (nomes apenas).
6. Access: aplicações e políticas que cobrem hosts da Odontobox. Inclua service tokens (nomes).
7. WAF/rate limit/Configuration Rules/Cache Rules que filtram hosts da Odontobox.
8. Turnstile: widgets e hostnames.
9. E-mail: Email Sending / Email Routing / Email Workers. Informe domínios remetentes, registros SPF/DKIM/DMARC dos hosts da Odontobox e o DMARC do apex `venn360.com` (só leitura; o `sp=` afeta os subdomínios novos).
10. DNS: todos os registros dos hostnames da Odontobox (app, staging, Evolution, e-mail).

## D. Neon (leitura)

1. Projeto(s) da Odontobox: ID, região, versão do Postgres, plano, retenção de histórico/PITR e se existem branches protegidas.
2. Branches: nome, pai, endpoint (host), compute (min/max CU), autosuspend e qual é produção e qual é staging.
3. Databases, roles, extensões (`SELECT * FROM pg_extension`) e quantidade de tabelas por schema.
4. Schema-only de produção: `pg_dump --schema-only --no-owner --no-privileges` → `infra/inventory/odontobox-schema-prod.sql`. Use role de leitura. Se não existir, peça ao André para criar uma role read-only ou autorizar o uso de uma existente.

## E. Reprodutibilidade das migrations

1. Crie um projeto Neon SEPARADO chamado `tmp-migration-check`, na mesma região e versão do Postgres. Alternativa: um container Postgres local, mesma versão major.
2. Rode TODAS as migrations do zero.
3. Gere o schema-only e compare com o de produção (normalize a ordem). Salve o diff em `infra/inventory/schema-diff.md`.
4. Classifique o resultado:
   - **IDÊNTICO:** pode duplicar.
   - **DIFERENÇAS:** liste cada uma. A Fase 02 cria a migration baseline.
5. Ao final, peça confirmação (R6) para apagar o projeto temporário.

## F. VPS Vultr (SSH somente leitura + MCP Vultr)

1. **Instância:** plano, vCPU, RAM, disco (total/uso), região, IP, firewall group (regras), backups automáticos e snapshots existentes.
2. **Sistema:** SO, versão do Docker/Compose, `free -h`, `df -h`, `docker stats --no-stream`, `docker ps -a` e `docker network ls`, `docker volume ls`.
3. **Para cada container:**
   - imagem e tag/digest;
   - origem do compose (caminho do arquivo) e portas publicadas (`0.0.0.0` vs `127.0.0.1`);
   - redes e volumes;
   - limites de memória/CPU e política de restart;
   - NOMES das variáveis de ambiente (mascare valores).
4. **Evolution:** está em uso **Evolution API v2 (Node)**, **Evolution Go**, ou ambos? Para cada container, informe:
   - versão;
   - hostname público;
   - banco usado;
   - prefixo/DB do Redis;
   - URL de webhook configurada;
   - quantidade de instâncias ativas, sem nomes de clientes;
   - se recebe tráfego (logs das últimas 24 h).
5. **Reverse proxy** (Caddy/Traefik/Nginx): arquivo de configuração, hostnames roteados, emissão de TLS e se a origem está atrás do proxy da Cloudflare.
6. **Postgres/Redis da VPS:** containers, bancos e roles existentes (`\l`, `\du`), `CONNECT` concedido a `PUBLIC`, ACL e uso de índices de DB no Redis.
7. **Capacidade:** estime o consumo de cada container Evolution e calcule se cabem mais 4 containers (Stagent prod/stg e Conecta prod/stg) com folga de 25% de RAM. Se não couber, diga quanto falta.

## G. Integrações

Para cada uma, informe o que for descobrível sem consoles: IDs públicos, nomes de variáveis, URLs de callback e webhook, escopos.

- **Google Calendar / login Google:** project ID ou client ID (é público), escopos, redirect URIs e status de verificação (se não for descobrível, pergunte).
- **Meta:** App ID(s), produtos usados (Instagram, Messenger, WhatsApp Cloud API), WABA/números (IDs), URLs de webhook, uso de verify token e validação `X-Hub-Signature-256`.
- **Outras:** gateway de pagamento, Sentry/logs, analytics, APIs de IA, SMS e qualquer outra encontrada no item A6.

## H. Revisão do staging atual da Odontobox

Monte uma tabela de paridade **produção × staging**. Para cada linha, marque: **isolado / compartilhado / inexistente**, com severidade **crítica / alta / média**.

Itens: Worker, banco (branch/projeto), Hyperdrive, R2, KV/Queues/DO, secrets, Evolution (container/chave/banco), Google, Meta, e-mail (staging envia para clientes reais?), crons com efeito externo, Access.

Qualquer recurso COMPARTILHADO entre produção e staging é achado **crítico**.

---

## Saídas obrigatórias

1. `infra/inventory/odontobox.md`: inventário completo (A–H).
2. `infra/inventory/odontobox-schema-prod.sql` e `infra/inventory/schema-diff.md`.
3. `infra/fingerprints/odontobox.json`, seguindo o formato de `infra/runbook/templates/fingerprint.example.json`, preenchido com TODOS os identificadores reais:
   - strings de marca e domínios;
   - IDs Cloudflare (Workers, KV, Hyperdrive, Queues, Access apps, Turnstile sitekeys) e nomes de buckets;
   - IDs de projeto e hosts de endpoint Neon;
   - containers, projetos compose, bancos e hostnames Evolution;
   - client IDs Google e App IDs Meta.

   Em `warnStrings`, coloque termos do segmento (ex.: `odontograma`, `dentista`).
4. `infra/reports/odontobox/fase-01.md` com:
   - resumo executivo (10 linhas);
   - lacunas de staging (H) por severidade;
   - resultado das migrations (E);
   - achados de segredos (B);
   - capacidade da VPS (F7);
   - resposta objetiva sobre o Evolution: **"Fase 04 necessária: SIM (migração API→Go) / LIMPEZA (remover API ociosa) / NÃO"**;
   - existência das zonas `stagent.com.br` e `conecta.com.br`;
   - lista de perguntas ao André.
5. Copie a pasta do runbook para `infra/runbook/`, se ainda não estiver lá.
6. Commit na branch e PR aberto (sem merge).

## Critérios de saída

- [ ] Nenhuma chamada de escrita em Cloudflare, Neon (exceto `tmp-migration-check`), VPS ou GitHub (exceto a branch/PR).
- [ ] Fingerprint com ≥ 1 entrada em cada categoria aplicável.
- [ ] Nenhum valor de segredo em nenhum arquivo.
- [ ] Relatório gerado. **PARE e aguarde "OK fase 01".**
