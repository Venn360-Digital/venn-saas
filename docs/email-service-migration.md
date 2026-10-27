# Migração para Cloudflare Email Sending

**Data:** 2026-10-26
**Mudança:** Resend → Cloudflare Email Sending
**Status:** código migrado; falta onboardar o subdomínio de envio no painel

## O que mudou no código

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Provedor | Resend (HTTP API) | binding `EMAIL` do Email Sending |
| Credencial | `RESEND_API_KEY` em secret | nenhuma — binding declarado em `cloudflare.config.ts` |
| Remetente | qualquer domínio | `mail.venn360.com`, subdomínio dedicado |

A assinatura de `sendEmail({ to, subject, html })` **não mudou**: quem chama —
o gancho de senha do Better Auth, os avisos de cobrança, as rotas — continua
igual. O binding chega por `registrarCosturas`, a mesma costura que entrega as
filas e os Durable Objects ao código da aplicação.

## O caso de uso, que decide a configuração

Estes e-mails vão para **destinatário diferente a cada envio**: o dono da
clínica, quem foi convidado para a equipe, quem pediu a senha de volta. Isso
tem duas consequências, e as duas contrariam o modelo de "formulário de
contato" que a documentação da Cloudflare usa de exemplo:

1. **O binding não trava o destino.** `bindings.sendEmail()` vai sem
   `destinationAddress`. Travá-lo faria a plataforma recusar todo envio que não
   fosse para o próprio endereço do sistema — ou seja, todos.
2. **Exige Workers Paid.** O envio gratuito vale só para destinatário
   verificado na conta. Não é um bloqueio aqui: a conta já está em Paid, porque
   Durable Objects e Queues exigem.

Não há limitador de envio no caminho. O limitador por IP que a documentação
sugere protege uma **rota pública** de virar relay aberto; aqui nenhum envio
nasce de requisição anônima — todos vêm de cron, de webhook do Asaas ou de
administrador autenticado. Um limitador global, além de não proteger nada,
descartaria em silêncio os avisos a partir da sexta clínica da mesma rodada do
cron.

## Checklist no painel da Cloudflare

### 1. Onboardar o subdomínio de envio

1. Zona **`venn360.com`** → **Email** → **Email Sending**
2. Adicionar `mail.venn360.com` como domínio de envio
3. Aplicar no DNS os registros **DKIM/SPF** que a Cloudflare gerar (a zona já
   está na Cloudflare, então é aplicar no mesmo painel)
4. Esperar o painel marcar o domínio como verificado

Sem este passo o envio falha com `E_SENDER_NOT_VERIFIED`.

### 2. Não tocar no MX do apex

O MX de `venn360.com` atende a **caixa de entrada** e está com outro provedor.
O subdomínio de envio não precisa de MX — só dos registros de assinatura. Mexer
no MX do apex derruba o e-mail da empresa.

### 3. Publicar o Worker

O binding é declarativo, mas só existe no Worker depois de publicado. Merge em
`main` → workflow **Produção** → aprovar o environment.

## Testar

Pelo fluxo real, que é o que prova a ponta a ponta:

1. **Redefinição de senha** — `/auth/esqueci-senha` com um endereço real. É o
   caminho mais curto: não depende de cron nem de webhook.
2. Conferir que a mensagem chega (inclusive no spam, que é onde cai domínio de
   envio sem reputação) e que o botão abre o link certo.
3. Conferir no `wrangler tail` que não houve erro de binding.

## Limpeza do Resend

1. ✅ Código e `.env.example`: `RESEND_API_KEY` já removido
2. **Secret:** `wrangler secret delete RESEND_API_KEY --name odontobox`
3. **Histórico do git:** `git log -S "RESEND_API_KEY" --oneline` — se a chave
   foi commitada em texto puro, **revogar no painel do Resend**; apagar o
   arquivo não tira do histórico

## Erros do binding

O erro carrega `code`, e é ele que diz se o problema é configuração ou volume:

| Código | Significado | O que fazer |
|--------|-------------|-------------|
| `E_SENDER_NOT_VERIFIED` | `mail.venn360.com` não onboardado | passo 1 |
| `E_INVALID_ADDRESS` | endereço malformado, ou destino recusado pelo binding | conferir que o binding não tem `destinationAddress` |
| `E_RATE_LIMIT_EXCEEDED` | teto da plataforma, não nosso | olhar volume no painel |

Falha de envio **não derruba quem chamou**: `sendEmail` devolve
`{ ok: false, error }` e o chamador registra. Um aviso de cobrança perdido é
recuperável; um cron que morre no meio da rodada não.
