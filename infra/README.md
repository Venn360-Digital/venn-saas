# `infra/` — o host do Evolution Go

> **Esta pasta não publica a aplicação.** A aplicação é um Worker da
> Cloudflare: publica no merge em `main`, pelo workflow do GitHub, e a
> configuração dela está em `cloudflare.config.ts`. O que sobra aqui é **uma
> máquina só** — a VPS da Vultr que roda o Evolution Go, porque o WhatsApp por
> QR precisa de um processo longo com estado, que Workers não têm.
>
> O runbook dessa máquina é [`docs/migration/12-evolution-vps.md`](../docs/migration/12-evolution-vps.md).

Até 2026-10-23 este arquivo descrevia outra coisa: um host único que rodava a
aplicação, o proxy, o Redis e a plataforma de backend anterior em Docker
Compose, em duas variantes de compose. Aquela máquina foi desligada no corte
para a Cloudflare e os dois composes, os dois geradores de ambiente e o script
que baixava a pilha de terceiro saíram do repositório junto. O texto antigo
está no histórico do git (`git log -- infra/README.md`); o levantamento daquele
host, com volumes e medições, está em
[`docs/migration/00-inventory.md`](../docs/migration/00-inventory.md).

## O que existe aqui

| Arquivo | Para quê |
|---|---|
| `compose.evolution-vps.yaml` | A pilha da Vultr: `postgres`, `evolution-go`, `cloudflared`. Projeto `odontobox-evolution`, então os contêineres são `odontobox-evolution-postgres-1` e `odontobox-evolution-evolution-go-1` |
| `.env.evolution-vps.example` | As variáveis daquele compose |
| `scripts/harden-host.sh` | Fecha o host em 22/80/443. **Não é opcional** — o compose publica portas e o Docker escreve as regras dele direto no iptables, passando por cima do ufw |
| `scripts/wa-guard.sh` | Vigia nº 1 (abaixo) |
| `scripts/wa-pool-guard.sh` | Vigia nº 2 (abaixo) |
| `scripts/levar-licenca.sh` | Leva `evogo_users` (licença) e, com `--sessoes`, `evogo_auth` de um host para outro |
| `scripts/levar-segredos.sh` | Grava os segredos no host |

Os padrões de contêiner nos dois vigias são os da Vultr. Eram os da máquina
antiga, e as unidades de lá sobrescreviam as variáveis — com aquele host
desligado, o padrão antigo deixava o vigia **falhando em silêncio** para quem o
rodasse à mão.

## Os vigias do Evolution Go

A imagem `evoapicloud/evolution-go` tem dois defeitos que não são nossos e que
nenhum código da aplicação contorna de dentro. Os dois são tratados por
serviços do host:

| Serviço | Script | O que vigia |
|---|---|---|
| `odontobox-wa-guard` | `wa-guard.sh` | Desliga o número ~105 s depois de parear. Reinicia o contêiner assim que `LoggedIn=true` |
| `odontobox-wa-pool` | `wa-pool-guard.sh` | Vaza conexões Postgres até esgotar `max_connections` — e aí **nenhum QR Code é gerado**, em silêncio. Reinicia quando passa de 60 conexões ociosas |

O segundo foi medido em 2026-10-14: 100 de 100 conexões abertas pelo Evolution
Go, todas ociosas, acumuladas desde a véspera. O sintoma que chega ao cliente é
"o QR não aparece"; a causa só se vê no log do contêiner:

```
Failed to create container: failed to upgrade database:
pq: sorry, too many clients already
```

### O terceiro defeito: a biblioteca apodrece sozinha

Não há vigia de host que resolva este. O whatsmeow compilado na imagem é de
junho/2026 e o WhatsApp **cortou o atendimento a ele** em 02/11/2026 — todas as
linhas dos três produtos caíram no mesmo instante, com `405 Client outdated`,
sem deploy nosso. A cura foi recompilar a 0.7.2 com o whatsmeow de 02/11, e a
imagem que roda nos três VPS passou a ser nossa: `evolution-go:0.7.2-whatsmeow-nov`.

Consequência permanente: **atualizar a biblioteca do WhatsApp é dependência
operacional dos três produtos**, e o corte não avisa. Receita, adaptações de
API e como provar a cura sem número real: runbook 09, seção do `405 Client
outdated`.

O que vigia este defeito não é um serviço do host e sim o alerta da aplicação
(`src/lib/alertas/linha-caiu.ts`), que manda e-mail para `suporte@venn360.com`
no instante em que uma linha cai. Sem ele, um corte deste tipo só aparece
quando o cliente reclama.

Reiniciar devolve as conexões (100 → 6) e **as sessões voltam sozinhas** pelo JID
guardado, porque `CONNECT_ON_STARTUP=true`. Nenhum número precisa ser pareado de
novo.

```bash
scp infra/scripts/wa-pool-guard.sh root@HOST:/usr/local/bin/odontobox-wa-pool.sh
ssh root@HOST 'chmod +x /usr/local/bin/odontobox-wa-pool.sh && systemctl enable --now odontobox-wa-pool'
journalctl -u odontobox-wa-pool -f
```

## Autenticação do Evolution Go

Vale saber antes de depurar: o header `apikey` carrega a **chave global** só nas
rotas de administração (`/instance/create`, `/instance/all`,
`/instance/delete/:id`) e o **token da instância** em todas as outras. Os
endpoints de envio não recebem parâmetro de instância — o token *é* o endereço.
Esse token mora em `AgentIntegration.config.token`, perdê-lo torna a instância
inalcançável, e `/instance/all` é o único lugar de onde ele se recupera.

## Licença

O Evolution Go exige uma ativação única antes de servir. A licença é gratuita
— nível comunitário, sem limite de instância ou mensagem — e a instância passa a
mandar heartbeats periódicos (versão, contadores agregados, recursos ligados, IP
do servidor; não o conteúdo das mensagens). **A ativação é ato humano**, feita no
manager:

```bash
ssh -N -L 8080:localhost:8080 root@<vps>
# depois abra http://localhost:8080/manager e entre com EVOLUTION_GO_API_KEY
```

O Evolution Go não é publicado: o manager só é alcançável por túnel SSH. O que
a borda alcança é `evo-odontobox.venn360.com`, pelo Cloudflare Tunnel e atrás do
Access com service token — ver
[`docs/migration/13-borda-cloudflare.md`](../docs/migration/13-borda-cloudflare.md).

## O canal oficial, e o token que não cabia

`whatsapp_business` fala **direto com a Graph API da Meta**
(`src/lib/whatsapp/meta-whatsapp.ts`); o Evolution API v2 foi aposentado como
intermediário. Fica registrado o que custou descobrir, para o caso de alguém
pensar em voltar a ele: medido em 2026-10-16, o v2 recusava o token de acesso da
Meta com `P2000 — The provided value for the column is too long`, porque a coluna
`Instance.token` do schema dele é `character varying(255)` e o token da Meta
passa disso com folga.
