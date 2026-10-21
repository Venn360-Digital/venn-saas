# 07 — Camada central de integrações

Inventário em [`00-inventory.md`](00-inventory.md) §7. Aqui está o desenho comum
que as integrações passam a compartilhar.

## O que existe, medido

| Integração | Direção | Credencial | Webhook |
| --- | --- | --- | --- |
| Google Calendar | saída + OAuth | OAuth por workspace | canal de notificação (expira) |
| WhatsApp QR (Evolution Go) | entrada + saída | chave de API + sessão por workspace | `webhooks/evolution-go` |
| WhatsApp Business (Evolution v2) | entrada + saída | chave de API | `webhooks/evolution` |
| Meta (Instagram / Messenger) | entrada + OAuth | app de plataforma + token por conta | `webhooks/meta` |
| ASAAS | entrada + saída | chave de plataforma | `webhooks/asaas` |
| Widget de site | entrada pública | chave por workspace na URL | — |
| Webhooks do agente | saída | por agente | — |
| Meta Ads / Google Ads / Analytics | **não existem** | — | — |

## Onde cada credencial vive  ✅ implementado

| Tipo | Lugar | Mecanismo |
| --- | --- | --- |
| Segredo global do app (Meta, Instagram, Asaas) | **Cloudflare Secrets** | `src/lib/secrets/ambiente.ts` |
| Token OAuth por workspace | **cifrado no Neon** | AES-256-GCM, `src/lib/secrets/envelope.ts` |
| `clientId` público | coluna em claro | é público; cofre só faria parecer secreto |

Os três campos que hoje guardam token em texto puro e passam a ser cifrados:
`Integration.config`, `AgentWebhook.authConfig`, `PlatformCredential.credentials`.

## Contrato de webhook — igual para todos

```
recebe → valida (por provedor) → grava evento mínimo → enfileira → responde 200
                                                           │
                                                           ▼
                                                     processa async
```

Responder rápido e processar depois não é otimização: provedor que não recebe
200 no prazo **reenvia**, e processar antes de responder transforma lentidão em
duplicata.

| Regra | Por quê |
| --- | --- |
| Validação específica por provedor | assinatura HMAC da Meta ≠ autenticação do Asaas |
| Limite de tamanho do payload | payload gigante é vetor de negação de serviço |
| **Persistir o evento antes de processar** | se o processamento falhar, o evento não se perde |
| Chave de idempotência | Queues entrega *at-least-once*; repetição é o normal |
| DLQ + reprocessamento | falha permanente não pode travar a fila |
| Métricas sem dado sensível | contagem e latência, nunca conteúdo |

### ASAAS — a regra que não pode ser violada

> **Nunca repetir uma operação financeira porque o webhook foi reenviado.**

Evento recebido e comando de cobrança são coisas separadas e ficam em caminhos
separados. O processamento é idempotente **pelo id do evento do Asaas**: visto
antes, descarta. Uma retentativa de rede não pode virar uma segunda cobrança.

Há também um defeito já conhecido e sem sintoma: a fila do Asaas **para depois
de 15 falhas seguidas** e os eventos deixam de chegar em silêncio. A vigia
(`src/lib/asaas/vigia.ts`) já existe e aparece na tela de administração —
preservar isso na migração.

### Google Calendar — entrega não é garantida

Os canais de notificação **expiram** e o Google não garante entregar todo
evento. Então:

- guardar cursor/`syncToken` por workspace;
- **renovar o canal** antes de expirar, por cron;
- **reconciliação periódica**, que é o que conserta o que a notificação perdeu.

Quem tratar notificação como fonte de verdade vai ter agenda divergente e não
vai saber por quê.

### Meta / WhatsApp — não são intercambiáveis

WhatsApp Cloud API (Evolution v2) e sessão QR (Evolution Go) têm modelos
diferentes de credencial, de sessão e de limite. `src/lib/whatsapp` já os põe
atrás de uma interface selecionada pelo canal — **preservar essa fronteira**.

Token de conta da Meta **não é eterno** (já corrigido no commit `003e777`) e tem
cron de renovação. Mantê-lo.

## Futuras Ads e Analytics

Adaptador documentado e **desligado**. Não registrar aplicativo, não pedir
escopo, não ligar conta até o André autorizar. Operação que inicia ou altera
campanha com gasto exige escopo próprio, limite e confirmação explícita — nunca
no mesmo caminho das integrações de leitura.
