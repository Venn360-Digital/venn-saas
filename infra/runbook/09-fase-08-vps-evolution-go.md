# FASE 08 — Containers Evolution Go do novo app na VPS existente

**Onde executar:** VPS Vultr via SSH, com o usuário dedicado (não root, grupo `docker`, chave SSH). Os registros vão no repositório do novo app, branch `chore/dup-evolution`.
**Modo:** Plan mode. Leia `infra/runbook/01-REGRAS-GLOBAIS.md` com atenção especial a **R6 e R7**: containers, bancos, volumes e redes de OUTROS apps só podem ser inspecionados.
**Não crie servidor novo.** Tudo acontece na VPS atual.

---

## Pré-condições (verifique e PARE se alguma falhar)

1. **Snapshot Vultr** feito nas últimas 2 horas. O André tira o snapshot pelo painel; confirme pelo MCP da Vultr (lista de snapshots) e registre o ID.
2. **Capacidade:** RAM livre ≥ consumo estimado dos 2 novos containers + 25% de folga (base: inventário F7). Se não houver, PARE e apresente as opções: upgrade de plano da VPS (mesmo servidor), staging sob demanda ou limites menores.
3. **Versão do Evolution Go:** a MESMA tag/digest fixada na Fase 04 (manifesto da Odontobox).
4. **Registro da situação inicial:** `docker ps --format '{{.Names}} {{.Status}}'`. Guarde o uptime de todos os containers existentes para comparar no final.

## Desenho (por ambiente: `prod` e `stg`)

| Item | Valor |
|---|---|
| Diretório | `/opt/evolution/evo-{slug}-{env}/` (owner do usuário dedicado, `chmod 750`) |
| Projeto compose | `name: evo-{slug}-{env}` no topo do `docker-compose.yml` |
| Container | `container_name: evo-{slug}-{env}` |
| Imagem | tag + **digest** fixados (nunca `latest`) |
| Porta | publicada **somente em `127.0.0.1`**, em porta livre (verifique com `ss -ltnp`) — ou sem publicar, se o proxy estiver na mesma rede Docker |
| Redes | rede própria `evo-{slug}-{env}-net`, mais a rede do reverse proxy, se ele rotear por rede Docker |
| Volume | `evo-{slug}-{env}-data` (instâncias e sessões) |
| Banco | `evo_{slug}_{env}` no Postgres da VPS, role `evo_{slug}_{env}` com senha nova, dona apenas desse banco |
| Redis (se usado) | índice de DB exclusivo (anote quais já estão em uso) + prefixo `{slug}_{env}` |
| Chave da API | nova (R8), em `.env` com `chmod 600` |
| Webhook | `https://<host do app no ambiente>/api/webhooks/<path do inventário>`, com segredo/header de autenticação novo |
| Limites | `mem_limit`, `cpus`, `restart: unless-stopped`, logging `json-file` com `max-size: 20m`, `max-file: 3` |

**Nomes de variáveis.** Os nomes de variáveis do Evolution Go mudam entre versões. Consulte o README/documentação da tag fixada e mapeie cada item da tabela (API key, banco, Redis, webhook, armazenamento) para o nome exato. Não suponha nomes.

## Passos

1. Gere a tabela acima preenchida para `prod` e `stg` e apresente-a. Execute só após "aprovado".
2. **Postgres da VPS** (no container Postgres compartilhado):
   ```sql
   CREATE ROLE evo_{slug}_{env} LOGIN PASSWORD '<gerada>';
   CREATE DATABASE evo_{slug}_{env} OWNER evo_{slug}_{env};
   REVOKE CONNECT ON DATABASE evo_{slug}_{env} FROM PUBLIC;
   ```
   - Teste que `evo_{slug}_{env}` **não** conecta em nenhum banco de outro app.
   - Se conectar, porque outro banco concede CONNECT a PUBLIC: NÃO altere o banco alheio. Reporte e sugira o ajuste ao André (com "confirmo" e snapshot).
3. Crie `docker-compose.yml` e `.env` em cada diretório. Valide com `docker compose config`.
4. `docker compose up -d` em `stg`. Verifique logs e healthcheck. Repita em `prod`.
5. **Reverse proxy:**
   - adicione os hostnames `stg-wa.stagent.com.br` e `wa.stagent.com.br` → containers correspondentes;
   - **valide a configuração antes de recarregar** (`caddy validate` / `nginx -t` / labels Traefik);
   - use **reload**, nunca restart do proxy;
   - TLS de origem: ACME do proxy ou Origin CA da Cloudflare (Fase 07, item 5).
6. **Firewall:**
   - confirme que as portas dos novos containers não estão expostas publicamente (`ss -ltnp` + `nmap` externo, se disponível);
   - se o firewall da Vultr ainda não restringe 80/443 aos IPs da Cloudflare, apenas RECOMENDE ao André. Essa mudança afeta todos os apps e exige OK e janela.
7. **Testes:**
   - `curl` via hostname público sem chave → negado (Access e/ou API key);
   - com service token do Access + API key → OK;
   - criar instância `{slug}-stg-teste` via API → aparece SÓ no container `evo-{slug}-stg`;
   - listar instâncias dos containers de outros apps (somente leitura): nenhuma instância `{slug}-*`;
   - o pareamento com celular de teste e o teste de webhook ponta a ponta ficam para a Fase 11 (o app ainda não está publicado).
8. **Comparação final:** `docker ps` novamente. O uptime de TODOS os containers pré-existentes deve continuar crescendo (nenhum foi reiniciado).
9. Grave as chaves e senhas geradas em `~/.venn360-secrets/{slug}/evolution-{env}.env` no Mac (via `scp` do arquivo, nunca imprimindo). Anote os fingerprints.
10. Copie os `docker-compose.yml` (SEM `.env`) para o repositório em `infra/vps/evo-{slug}-{env}/`, para versionamento. Adicione um `.env.example` com os nomes.

## Manifesto e fingerprint

Preencha `environments.<env>.evolution`:
- container, projeto compose, diretório, porta interna, banco/role, Redis DB/prefixo;
- hostname, tag/digest;
- prefixo de instância e URL de webhook.

Adicione containers, bancos e hostnames ao `infra/fingerprints/{slug}.json`.

## Saídas

- `infra/vps/` com os composes.
- `infra/reports/{slug}/fase-08.md`: ID do snapshot, tabela final, consumo de RAM antes e depois, evidências dos testes, comparação de uptime e fingerprints.

## Critérios de saída

- [ ] 2 containers novos (`prod`, `stg`), cada um com banco, role, chave, volume e webhook próprios.
- [ ] Nenhum container, banco ou volume de outro app alterado ou reiniciado.
- [ ] Portas não expostas publicamente.
- [ ] **PARE e aguarde "OK fase 08".**
