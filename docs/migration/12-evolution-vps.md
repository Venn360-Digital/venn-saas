# 12 — Evolution Go no VPS (canal QR fora de Cloudflare Containers)

Runbook do corte que move o Evolution Go + seu Postgres de Cloudflare Containers
para a VPS Stay Cloud reformatada. App segue em Cloudflare Workers + Neon + R2.
Plano aprovado em 2026-10-23 (`~/.claude/plans/gentle-sniffing-aho.md`).

**Porquê (resumo):** o whatsmeow mantém socket persistente 24/7; Cloudflare
Containers dorme na ociosidade e acorda frio. Medido: `/send/text` em ~4,8 s
(~4,4 s dentro do contêiner). Na VPS era <1 s. Sem economia financeira — ganho é
adequação de plataforma, isolamento de falha (VPS cai → só o QR cai) e desempenho.

## Artefatos neste repositório
- `infra/compose.evolution-vps.yaml` — stack autocontido (Postgres dedicado +
  db-init + Evolution Go 0.7.2 + cloudflared).
- `infra/.env.evolution-vps.example` — variáveis do compose.
- `infra/scripts/harden-host.sh`, `levar-licenca.sh` — reaproveitáveis.
- Frente de código: branch `migracao/evolution-no-vps` (2 commits), **não
  mesclada**. Autentica o webhook e vira o transporte para HTTP.

## Pré-requisitos / segredos
| Onde | Segredo | Valor |
|---|---|---|
| VPS (`.env.evolution-vps`) | `EVOLUTION_GO_API_KEY` | chave global; a MESMA do app |
| VPS | `EVO_DB_PASSWORD` | senha do Postgres dedicado (só na VPS) |
| VPS | `CLOUDFLARE_TUNNEL_TOKEN` | do painel Zero Trust → Tunnels |
| App (Cloudflare secret) | `EVOLUTION_GO_URL` | `https://evo-odontobox.<domínio>` (hostname do Tunnel) |
| App (Cloudflare secret) | `EVOLUTION_GO_API_KEY` | igual à da VPS |
| App (Cloudflare secret) | `EVOLUTION_WEBHOOK_SECRET` | segredo que vai no caminho do webhook |
| App (já existe) | `NEXT_PUBLIC_APP_URL` / `WEBHOOK_BASE_URL` | base pública do app |

Segredos do app por `wrangler secret put` (André executa) — nunca no repositório.

## Ordem de corte
1. **VPS pronta.** Formatar (Ubuntu LTS). `harden-host.sh` (não-root, SSH por
   chave, ufw negando inbound exceto SSH, fail2ban, unattended-upgrades, Docker).
   Criar o Tunnel no painel Cloudflare, rota do hostname → `http://evolution-go:8080`.
   `docker compose -f infra/compose.evolution-vps.yaml --env-file .env.evolution-vps up -d`.
   Ativar a licença uma vez pelo `/manager` por túnel SSH
   (`ssh -N -L 8080:127.0.0.1:8080 root@<vps>` → `http://localhost:8080/manager`).
   Conferir `/server/ok` pelo hostname do Tunnel.
2. **Deploy do app** (mesclar a branch `migracao/evolution-no-vps` em main) com os
   3 segredos do app aplicados. A virada de transporte entra aqui. **NÃO antes:**
   sem `EVOLUTION_GO_URL`, toda chamada ao Evolution lança.
3. **Desligar o Evolution da Cloudflare** (parar o Worker/Container POC) para não
   disputar o aparelho.
4. **Reparear.** Na tela de agentes, conectar a linha → app chama o VPS
   (`/instance/create` → `/instance/connect` com o webhook real+segredo →
   `/instance/qr`) → escanear. Postgres do VPS nasce vazio, então é pareamento do
   zero (decidido: sem migrar `evogo_auth`).
5. **Verificar** (abaixo). Rodar ~1 dia.
6. **Aposentar:** apagar `poc/canal-whatsapp/`, o projeto Neon `odontobox-evolution`
   e o Launch, e os segredos órfãos do POC.

**Rollback (até o passo 6):** reverter os 2 commits da branch (re-registrar o
gateway + binding) e republicar → volta ao Container da Cloudflare.

## Dois pontos que precisam de ajuste NA máquina (não embarcados)
Os vigias de host de hoje (`infra/scripts/wa-guard.sh`, `wa-pool-guard.sh`)
assumem o app DB (`supabase-db`) e um nome de contêiner antigos — ambos inválidos
na VPS dedicada (o app DB agora é Neon). Antes de confiar neles:

- **Nome do contêiner:** passa a `odontobox-evolution-go-1` (o `name:` do compose
  é `odontobox-evolution`). Ajustar `C=` nos dois scripts.
- **Token da instância (`wa-guard.sh` → `token_for`)**: não consultar `supabase-db`;
  pegar o token no **próprio Postgres do Evolution** (tabela `instances` em
  `evogo_users`) ou detectar `LoggedIn` pelo log do contêiner. Testar na máquina.
- **Rearme do webhook após restart:** o Evolution 0.7.2 guarda o webhook na
  requisição `/instance/connect`, não no banco — ele some num restart, e o inbound
  para calado (era o que o Durable Object re-armava). Na VPS, após cada
  (re)subida do contêiner, reaplicar o webhook por instância. Implementar como
  script de host/systemd que, ao subir, chama `/instance/connect` com a URL
  `${NEXT_PUBLIC_APP_URL}/api/webhooks/evolution-go/${EVOLUTION_WEBHOOK_SECRET}`
  e o token de cada instância conectada. Validar com um restart proposital antes
  de confiar.

## Verificação (fim a fim)
- `/server/ok` respondendo pelo hostname do Tunnel (e recusando sem Access service
  token, se adotado).
- Webhook: `POST .../api/webhooks/evolution-go/<segredo-errado>` → **401**;
  `.../<segredo-certo>` → enfileira. (`wrangler tail odontobox` + curl.)
- Receber mensagem do paciente → aparece na conversa. Enviar pela tela → chega.
  Imagem ida e volta abre.
- **Latência:** medir `/send/text` nos tails — meta <1 s (contra ~4,8 s no
  Container). É a prova do ganho.
- Restart proposital do contêiner → a linha reconecta sozinha (`CONNECT_ON_STARTUP`)
  **e** o webhook volta (rearme) — inbound continua chegando.

## Segurança (do parecer)
- Webhook do app agora é público → autenticado por segredo no caminho (feito na
  branch). Sem `EVOLUTION_WEBHOOK_SECRET`, a porta recusa tudo (503).
- VPS: Tunnel sem porta aberta, Evolution em loopback, Postgres não exposto.
  Endurecer o hostname do Tunnel com **Access service token** (o provider injeta
  `CF-Access-Client-Id/Secret` — delta pequeno, pendente).
- `evogo_auth` é sensível (sessão de WhatsApp da clínica): **backup cifrado** e
  acesso mínimo. Sem backup, um desastre força reparear.
- Disponibilidade: WhatsApp é canal central; `restart: always` + monitoramento +
  alerta no `/server/ok`.
