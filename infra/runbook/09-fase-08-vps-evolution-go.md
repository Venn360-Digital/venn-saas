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

---

## RESOLVIDO: `405 Client outdated` derrubou o WhatsApp dos três produtos (02–03/11/2026)

### O sintoma

Todas as linhas caíram ao mesmo tempo, sem deploy nosso e sem mudança de
configuração. Na tela do app: "Lendo QR-CODE" para sempre. No contêiner, a
cada tentativa de conectar:

```
405 Client outdated
```

### A causa

A biblioteca **whatsmeow** compilada dentro do `evoapicloud/evolution-go:0.7.2`
é de **junho de 2026**. O WhatsApp cortou o atendimento a essa versão do
protocolo. O corte é do lado deles: nada no nosso lado expira, nada reverte.

Duas coisas que **não** são a causa, e foram descartadas com medição:

- **Não é licença.** A licença do Evolution estava válida; renovar não mudou
  nada. O e-mail de validação de licença que chegou no mesmo dia é
  coincidência, não gatilho.
- **Não são as variáveis `WHATSAPP_VERSION_*`.** Elas existem no Evolution Go,
  mas **não participam do aperto de mão**. Mexer nelas não tem efeito sobre o
  405. Não perca tempo aqui.

E uma armadilha caríssima: a imagem **`0.7.2-beta`** (01/10) **não corrige** o
405 **e apaga os JID, ID e token das instâncias**. Não a use. A recuperação
exigiu restaurar o dump.

### A cura

Recompilar a 0.7.2 com o whatsmeow de **02/11/2026**. Quatro assinaturas
mudaram na API nova, todas em `pkg/user/service/user_service.go`:

| Antes | Depois |
|---|---|
| `UpdateBlocklist(ctx, jid, action)` (2 ocorrências) | `UpdateBlocklist(ctx, jid, action, "")` |
| `GetBlocklist(ctx)` | `GetBlocklist(ctx, "")` |
| `SetStatusMessage(ctx, data.Status)` | `SetStatusMessage(ctx, types.SetStatusInput{Text: &data.Status})` |

A imagem resultante é `evolution-go:0.7.2-whatsmeow-nov` (303 MB), publicada
nos três VPS.

### Por que a imagem viaja em arquivo, e não por cano

Os VPS dos clones têm **1 GB de RAM** — compilar Go lá não cabe. A imagem é
construída no VPS da Odontobox e **transferida como arquivo com sha256
conferido nas três pontas**.

Não use `docker save | ssh | docker load`: o cano não tem como verificar o que
chegou, e já falhou com `gzip: stdin: unexpected end of file` seguido de
`unrecognized image format`. Carregar imagem truncada num host de produção
falha de um jeito confuso, longe da causa.

### Como provar que a cura pegou, sem número real

Ausência de erro no log **não** prova nada: o 405 só aparece quando se tenta
conectar. Crie uma instância descartável, conecte e confira que o QR nasce —
QR gerado significa aperto de mão aceito pelo WhatsApp. Depois apague a
instância.

```bash
K=$(grep -E "^EVOLUTION_GO_API_KEY" /opt/evolution/.env | cut -d= -f2-)
TOK="zzteste$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
curl -s -X POST http://127.0.0.1:8080/instance/create -H "apikey: $K" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"zz_teste_handshake\",\"token\":\"$TOK\"}"
curl -s -X POST http://127.0.0.1:8080/instance/connect -H "apikey: $TOK" \
  -H 'Content-Type: application/json' -d '{}'
sleep 12
curl -s http://127.0.0.1:8080/instance/status -H "apikey: $TOK"
# esperado: {"Connected":true,"LoggedIn":false} + QR no log
curl -s -X DELETE "http://127.0.0.1:8080/instance/delete/<id>" -H "apikey: $K"
```

Note a forma das rotas, que não é óbvia: `create` exige **`name`** (não
`instanceName`) **e `token`** inventado pelo chamador; `connect` é
**`POST /instance/connect`** sem parâmetro de caminho, autenticado com o
**token da instância** — a chave global só serve nas rotas administrativas.

### O que isso passa a significar para o produto

**Atualizar a biblioteca do WhatsApp virou dependência operacional dos três
produtos.** O corte parte do WhatsApp, atinge os três ao mesmo tempo e não
avisa. Duas consequências práticas:

1. A imagem recompilada é **nossa** agora — não há mais `docker pull` que
   resolva. Quem recompilar precisa repetir as adaptações da tabela acima (ou
   as que a API nova exigir no momento).
2. O **terceiro vigia** (`src/lib/alertas/linha-caiu.ts`, e-mail imediato para
   `suporte@venn360.com`) é o que transforma "o cliente descobriu" em "nós
   descobrimos". Sem ele, este incidente só aparece quando alguém reclama.
