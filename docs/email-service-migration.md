# E-mail transacional pelo Cloudflare Email Sending

**Configurado em:** 2026-10-27
**Estado:** subdomínio de envio verificado (`ready`), Worker publicado, Resend desativado

## O desenho

| Aspecto | Valor |
|---------|-------|
| Remetente | `OdontoBox360 <noreply@mail.venn360.com>` |
| Subdomínio de envio | `mail.venn360.com` |
| Seletor DKIM | `cf-bounce` |
| Return-Path | `cf-bounce.mail.venn360.com` |
| Cota | **200 envios/dia** na conta |

A assinatura de `sendEmail({ to, subject, html })` é a mesma de quando o envio
era pelo Resend: um argumento, sem nada de plataforma. O binding chega por
`registrarCosturas`, a mesma costura que entrega filas e Durable Objects.

`noreply@` é literal: **`mail.venn360.com` não tem MX**, então o subdomínio só
envia e qualquer resposta é devolvida. Por isso o rodapé padrão em `layout.ts`
diz que o endereço não recebe respostas, em vez de convidar a responder.

## Por que o binding não trava o destino

`bindings.sendEmail()` vai **sem `destinationAddress`**. Travar o destino serve
a formulário de contato, onde o destinatário é sempre a mesma caixa. Aqui cada
envio vai para uma pessoa diferente — dono de clínica, convidado, quem pediu a
senha de volta — e com a trava a plataforma recusaria todos.

Também não há limitador no caminho de envio. O limitador por IP que a
documentação sugere protege **rota pública** de virar relay aberto; aqui nenhum
envio nasce de requisição anônima. Um limitador global descartaria em silêncio
os avisos a partir da sexta clínica da mesma rodada do cron.

## O que está publicado no DNS

Criados pelo próprio Email Sending (`POST .../subdomains/{tag}/dns`):

| Tipo | Nome | Conteúdo |
|------|------|----------|
| MX | `cf-bounce.mail.venn360.com` | `route1/2/3.mx.cloudflare.net` (prio 43/80/61) |
| TXT | `cf-bounce.mail.venn360.com` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT | `cf-bounce._domainkey.mail.venn360.com` | chave DKIM |
| TXT | `_dmarc.mail.venn360.com` | `v=DMARC1; p=reject;` |

Tudo fica sob `cf-bounce.` — nada no apex foi tocado. O **MX de `venn360.com`
continua em `smtp.google.com`**, que é a caixa de entrada da empresa, e o SPF
do apex continua o do Google.

O `p=reject` em `_dmarc.mail.venn360.com` é política só do subdomínio de envio;
o apex mantém o `p=quarantine` que já tinha. Reject é adequado aqui porque
`mail.venn360.com` tem um remetente só — qualquer coisa assinada de outro jeito
é falsificação.

## Verificar o estado

```bash
npx wrangler tail odontobox
```

Pela API, o status do subdomínio de envio:

```
GET /zones/f01f6a4a622fb37f5ba0c7bbe0869fde/email/sending/subdomains
GET /zones/f01f6a4a622fb37f5ba0c7bbe0869fde/email/sending/subdomains/{tag}/dns/status
GET /accounts/7ee4810a45580562977d68b86ec709e7/email/sending/limits
```

`.../dns/status` devolve `status: "ready"` e `errors: []` quando o DNS está
completo. `limits` mostra quanto da cota diária já saiu.

## Testar

```bash
./scripts/testar-email.sh andre@venn360.com
```

Dispara a redefinição de senha, que é o único dos onze alcançável de fora sem
sessão. Os outros nascem de administrador autenticado, de cadastro, de webhook
do Asaas ou do cron — o script lista o que provoca cada um.

## Erros do binding

O erro carrega `code`, e é ele que diz se o problema é configuração ou volume:

| Código | Significado | O que fazer |
|--------|-------------|-------------|
| `E_SENDER_NOT_VERIFIED` | subdomínio saiu do `ready` | conferir `.../dns/status` |
| `E_INVALID_ADDRESS` | endereço malformado, ou destino recusado | conferir que o binding segue sem `destinationAddress` |
| `E_RATE_LIMIT_EXCEEDED` | cota de 200/dia | ver `.../sending/limits` |

Falha de envio **não derruba quem chamou**: `sendEmail` devolve
`{ ok: false, error }` e o chamador registra. Um aviso de cobrança perdido é
recuperável; um cron que morre no meio da rodada não.

## Resend

Desativado e **limpo em 2026-10-28**. Os registros dele (`send.mail`,
`rsend.mail`, `resend._domainkey.mail`) saíram da zona, o segredo órfão
`RESEND_API_KEY` saiu do Worker `odontobox` e a política de privacidade não o
lista mais como subprocessador — quem envia agora é a Cloudflare.

A chave **nunca foi commitada** (`git log -S "RESEND_API_KEY"` não acha valor
nenhum, e não há `re_…` em commit algum), mas estava em texto puro no `.env`
local, de onde foi retirada. **Revogar no painel do Resend é ato humano** e
segue pendente: chave que existiu em disco se revoga por higiene, não por
suspeita.
