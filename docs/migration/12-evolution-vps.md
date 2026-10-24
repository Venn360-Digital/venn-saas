# 12 — Evolution Go no VPS (canal QR fora de Cloudflare Containers)

Runbook do corte que move o Evolution Go + seu Postgres para uma **VPS Vultr
dedicada** (`odontobox`, São Paulo, 216.238.127.233). Plano aprovado em
2026-10-23 (`~/.claude/plans/gentle-sniffing-aho.md`).

> ### ⚠️ Esse IP está travado numa regra de WAF da Cloudflare
>
> Desde 2026-10-24, `/api/webhooks/evolution-go/*` **só aceita requisição
> de `216.238.127.233` e da rede IPv6 `2001:19f0:b800:2539::/64`** — o
> segredo do webhook vai no caminho da URL e aparece em log de proxy, então
> o IP é a segunda tranca.
>
> **Basta trocar a instância, recriá-la ou mudar o IP para o WhatsApp parar
> de receber — em silêncio.** As mensagens não chegam e a tela segue dizendo
> "No ar", porque o `integration-health` confere a conexão com o provedor,
> não a entrega do webhook.
>
> A regra é `c1c1d3331574494bbc87787233fd5bd5`, no ruleset
> `regras-proprias`. Ver [`13-borda-cloudflare.md`](13-borda-cloudflare.md).

> **Correção de 2026-10-23, depois de executar.** A versão original deste
> runbook mandava **formatar a VPS Stay Cloud** e partia de "o app já está em
> Cloudflare Workers + Neon + R2". As duas coisas estavam erradas e, juntas,
> destruiriam a produção:
>
> - `odontobox.venn360.com` resolve para **157.254.207.42 — a Stay Cloud**. O
>   Worker `odontobox` está no ar **sem rota**.
> - Medido no contêiner de produção: `DATABASE_URL` aponta para `supabase-db`
>   (não Neon), o Better Auth é o `supabase-auth` local, não há variável de R2,
>   e o Evolution que a produção usa é `http://evolution-go:8080` — o contêiner
>   da própria Stay Cloud, não o Container da Cloudflare.
>
> Ou seja: a Stay Cloud **é** a produção inteira — app, banco, arquivos, os dois
> Evolutions e o Traefik que termina o TLS. **Não formatar.** O que vive em
> Cloudflare Containers é o POC. A instância Vultr torna o format desnecessário:
> o Evolution sobe ao lado, sem desligar nada.
>
> A Stay Cloud só pode ser formatada depois de o app ir para o Worker, os dados
> para o Neon, os arquivos para o R2 e o DNS virar — e com dump do `supabase-db`
> e do `supabase-storage` antes.

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
1. **VPS pronta.** ✅ **FEITO em 2026-10-23** na Vultr `odontobox`.
   Três armadilhas encontradas ao executar, que o texto anterior escondia:

   - **`harden-host.sh` não faz o que este runbook prometia.** Ele faz **só**
     `ufw` + as regras `DOCKER-USER`. Não cria usuário não-root, não desliga
     senha no SSH, não instala fail2ban, unattended-upgrades nem Docker. Tudo
     isso foi instalado à mão.
   - **No Ubuntu 26.04 o `ufw` conflita com o `iptables-persistent`** (`ufw
     Breaks iptables-persistent`), então o `netfilter-persistent save` que fecha
     o script **não existe**. Sem contorno, as regras `DOCKER-USER` somem no
     primeiro reboot e as portas publicadas por contêiner voltam a ficar
     alcançáveis, em silêncio. Persistidas no `/etc/ufw/after.rules`, que o
     próprio ufw recarrega no boot.
   - **O script abre 80 e 443.** Faz sentido na Stay Cloud, que tem Traefik.
     Aqui não: o `cloudflared` faz conexão **de saída** e nada precisa escutar.
     Esta máquina ficou com **só a 22** aberta — verificado de fora: 80, 443,
     8080 e 5432 fechadas.

   Estado final: Docker 29.9.2 + compose 5.6.1 (repositório oficial; o codinome
   `resolute` É suportado), fail2ban e unattended-upgrades ativos, Evolution Go
   0.7.2 + Postgres dedicado `healthy`, `evogo_auth`/`evogo_users` criadas,
   **licença ativada** (gravada em `runtime_configs`), Tunnel
   `odontobox-evolution` com rota `evo-odontobox.venn360.com` →
   `http://evolution-go:8080` e CNAME proxied. Provado de fora:
   `/server/ok` → 200; `/instance/all` sem chave → **401**, com a chave → 200.
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

## Ajustes dos vigias — FEITOS em 2026-10-23 (ler as ressalvas)

Os três agora estão no repositório. Dois achados mudaram a forma:

- **Os vigias foram PARAMETRIZADOS, não reescritos.** `wa-guard.sh` e
  `wa-pool-guard.sh` ainda guardam o Evolution **de produção na Stay Cloud**;
  fixar o nome novo neles quebraria aquele host. Leem `EVO_CONTAINER`,
  `EVO_PG_CONTAINER`, `EVO_DB` e `EVO_API`, com os padrões antigos. Na Vultr:
  `EVO_CONTAINER=odontobox-evolution-evolution-go-1`,
  `EVO_PG_CONTAINER=odontobox-evolution-postgres-1`.
- **O webhook ESTÁ no banco.** A tabela `instances` do `evogo_users` tem as
  colunas `token` e `webhook` — ao contrário do que a versão anterior deste
  documento afirmava ("o Evolution guarda o webhook na requisição, não no
  banco"). O que não foi verificado é se ele é **relido no restart**. O rearme
  aproveita isso e reaplica exatamente o que está gravado, sem depender de
  variável de ambiente.
- **`wa-webhook-guard.sh` nasce em MODO DE ENSAIO**, e isso é deliberado: o
  efeito de `/instance/connect` sobre uma linha já logada não é verificável por
  leitura, e no dia em que foi escrito não havia nenhuma linha pareada para
  testar. `immediate:true` pode forçar QR e derrubar a linha que ele queria
  salvar; `immediate:false` pode ser inócuo e não gravar nada. O procedimento de
  validação está no cabeçalho do próprio arquivo. **Não ligue no systemd antes
  de validar com um restart proposital.**
- **O rearme não é só de boot.** O `wa-guard.sh` reinicia o contêiner de
  propósito logo após o pareamento — então o caminho mais comum de perder o
  webhook é justamente parear uma linha nova. Por isso o vigia escuta eventos
  `start` do Docker, e não só a subida da máquina.

### Texto original (mantido por referência)
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

## A porta sem autenticação — bloqueada em 2026-10-23, antes do corte

A revisão da frente de código encontrou um problema que **não é da migração**:
`/api/webhooks/evolution-go` (sem o segmento do segredo) aceita POST anônimo e
enfileira. Medido em produção: `GET` devolvia 200 e `POST {}` chegava no
handler. O único obstáculo para forjar uma mensagem de entrada, acionar o
agente e mandar WhatsApp em nome da clínica é conhecer um `instanceId` — um
UUID, que não é segredo e vaza em log.

O comentário que a justificava no código está errado em dois pontos: fala em
"binding interno" (é a rede do compose) e em "caminho confiável" (o mesmo
caminho estava aberto para qualquer um na internet).

**E ela não tinha chamador legítimo pela internet:** `WEBHOOK_BASE_URL` em
produção é `http://app:3000`, então o Evolution local posta por dentro da rede
do Docker, sem passar pelo Traefik.

Fechada por `infra/compose.bloqueio-webhook.yaml` — um contêiner próprio cujas
labels declaram um router de prioridade alta com `ipallowlist` só de loopback.
Escolhido assim porque o Traefik daquele host só tem provider do Docker, label
não muda em contêiner de pé, e a mudança não podia entrar por git (o host está
em `main`, e push em `main` dispara o deploy da Cloudflare).

Verificado: de fora, `GET` e `POST` → **403**; `/evolution-go/{segredo}` segue
livre; o caminho interno segue respondendo; `/login` e os webhooks da Meta e do
Asaas intactos.

**No corte, isto morre junto com a porta sem segredo** — apagar a rota do
código e `docker compose -f infra/compose.bloqueio-webhook.yaml down`.

## O rearme de webhook NÃO é necessário — medido em 2026-10-23

A versão anterior deste runbook afirmava que o Evolution guarda o webhook só na
requisição `/instance/connect` e que ele **some num restart**, deixando o
inbound parar em silêncio — e previa um vigia para reaplicá-lo. Medido com a
linha real pareada: **é falso nesta pilha.**

Sequência observada, com o `wa-guard` reiniciando o contêiner 9 s após o
pareamento (o contorno do laço de QR, que é real e continua necessário):

```
20:52:39  Successfully paired 553131918001:24
20:52:44  wa-guard: LoggedIn=true after 5s
20:52:48  wa-guard: restarted
--- depois do restart, sem rearme nenhum ---
          connected=true, LoggedIn=true
          webhook=…/api/webhooks/evolution-go/<segredo>   ← intacto
          4 entregas de webhook bem-sucedidas, zero falhas
```

E em seguida, tráfego real: texto, imagem e áudio nos dois sentidos, mídia
gravada no R2 e áudio de entrada transcrito.

**O Evolution relê o webhook do banco ao subir.** O `wa-webhook-guard.sh` foi
apagado em vez de ficar guardado "para ligar depois": um vigia que reaplica
webhook sem necessidade é risco sem ganho — se o valor no banco estiver velho
(depois de rotacionar o segredo, por exemplo), ele reaplica o errado para
sempre e diz "reaplicado (HTTP 200)" a cada restart.

O que **continua** necessário é o `wa-guard.sh`: sem ele o Evolution desloga a
sessão que acabou de criar no 5º QR (~105 s). Visto nesta máquina antes de o
vigia existir — a linha pareou e caiu em 41 s.

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
