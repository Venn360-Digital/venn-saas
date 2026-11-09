# Recurso do pedido de produção do SES — caso 179414198400769

**Situação:** o pedido foi enviado e **negado**. O registro da conta ficou com
`ReviewDetails.Status: DENIED`, e a partir daí o `put-account-details` responde
`ConflictException` a qualquer chamada — inclusive para só corrigir a URL. O
único caminho é o **AWS Support Center**, respondendo no caso que já existe.

## A causa provável, e ela era evitável

O pedido declarou `WebsiteURL: https://odontobox360.com`, **e esse domínio não
existe** — não resolve em DNS. O revisor da AWS abre essa URL para entender que
conteúdo a conta vai enviar; uma que não carrega é, sozinha, motivo de recusa.

Somado a isso, a conta tinha **zero identidades verificadas** no momento do
pedido. O próprio manual da AWS diz: *"verifying your domain with SES before
requesting production access is a best practice that helps to get your
production access request approved faster"*. Pedir produção sem nenhum domínio
verificado e com um site inexistente é o perfil de conta que o sistema recusa.

**As duas coisas foram corrigidas antes de recorrer** (ver o fim deste arquivo).

## Onde responder

Support Center → o caso **179414198400769**:

<https://console.aws.amazon.com/support/home#/case/?displayId=179414198400769>

Se o caso não aparecer como respondível, abra um novo em **Create case →
Looking for service limit increases? → Service: SES Sending Limits → Region:
US East (Ohio)**, citando o número acima. Limite de serviço é gratuito em
qualquer plano de suporte — não exige Business nem Enterprise (a *API* de
suporte é que exige, e é por isso que isto não dá para automatizar).

---

## Texto para colar

> Hello,
>
> I'm appealing the denial of case 179414198400769 (SES production access,
> us-east-2).
>
> **First, a correction.** The request was submitted with the website URL
> `https://odontobox360.com`, which was a mistake on our side — that domain does
> not exist. Our company website is **https://venn360.com**. The product this
> account will send for is at **https://odontobox.venn360.com** (it redirects to
> a login page, as it is a private B2B application).
>
> The API no longer lets me edit the account details after the review closed, so
> I am providing the correct information here.
>
> **What we are.** Venn360 operates three B2B SaaS products used by dental
> clinics and small agencies in Brazil to manage their own patient and client
> relationships. We are not an email marketing provider, and we do not send on
> behalf of anonymous senders.
>
> **Who receives the email.** Each of our customers sends only to contacts that
> already exist in their own practice-management records — people who are
> already their patients or clients. We do not import, buy, rent or share lists,
> and a customer cannot email anyone outside their own tenant's contacts.
>
> **Sender identity is per customer, not shared.** Every customer verifies their
> own domain in SES via Easy DKIM (three CNAME records they publish in their own
> DNS zone), and campaigns are sent only from a domain in `verified` state. A
> campaign cannot leave draft otherwise. We deliberately do not send marketing
> from a shared Venn360 domain, precisely so that one customer's behavior cannot
> affect another's deliverability.
>
> **Unsubscribe handling.** Every campaign message carries `List-Unsubscribe`
> together with `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058),
> so one-click unsubscribe works natively in Gmail and Outlook. Every message
> also carries a visible unsubscribe link in the footer, which is part of the
> template shell and cannot be removed by the customer. That endpoint is public,
> requires no login, and records the opt-out immediately against that contact in
> that tenant. Opted-out contacts are excluded at list-build time, not only at
> send time.
>
> **Bounce and complaint handling.** Account-level suppression is enabled for
> both `BOUNCE` and `COMPLAINT`. In addition, our application calls
> `PutSuppressedDestination` and records a per-contact opt-out, so a recipient
> who bounces or complains is removed both at the account level and inside the
> tenant that mailed them. We maintain a separate configuration set per product
> so delivery events can be attributed and monitored per product.
>
> **Transactional mail does not use this account.** Password resets, invitations
> and billing notices are sent through a different provider entirely. This SES
> account is used only for customer-initiated campaigns, so its reputation
> reflects exactly one kind of traffic.
>
> **Volume.** We expect to start in the low thousands of messages per month and
> grow gradually with our customer base. We are not requesting a large initial
> quota — the default production limits are more than sufficient.
>
> **Verification state.** I have now verified `mkt.venn360.com` in this account
> (Easy DKIM, RSA 2048, CNAMEs published and resolving) so you can confirm we
> control the domain we are sending from.
>
> Thank you for reconsidering.
>
> André — andre@venn360.com

---

## O que foi corrigido antes do recurso

| | Antes | Agora |
|---|---|---|
| URL do site | `odontobox360.com` — **não existe** | `venn360.com` — responde 200, descreve a empresa |
| Identidades verificadas | nenhuma | `mkt.venn360.com`, Easy DKIM RSA 2048, três CNAME publicados em `venn360.com` e resolvendo |
| Configuration sets | nenhum | três, um por produto |
| Supressão | padrão | `BOUNCE` e `COMPLAINT` ativas |

## O que a resposta afirma, e onde isso está no código

Cada frase do texto acima foi conferida contra o repositório — nenhuma é
aspiracional:

| Afirmação | Onde |
|---|---|
| `List-Unsubscribe` + `List-Unsubscribe-Post` em todo envio | `src/lib/email/ses.ts` |
| Link de descadastro no rodapé, não removível pelo cliente | `src/lib/email/blocos.ts` (`renderCampanha`) |
| Descadastro público, sem login, grava na hora | `src/app/descadastro/[token]/page.tsx` |
| Opt-out excluído já na montagem da lista | `src/lib/marketing/lists.ts` (`whereDoFiltro`) |
| Campanha só sai de remetente `verified` | `src/trabalhos/servicos/broadcast.ts` |
| Chamada de supressão no SES | `src/lib/email/ses.ts` |
| Transacional por outro provedor | `src/lib/email/send.ts` (Cloudflare) |

**Uma ressalva honesta:** os *event destinations* dos configuration sets ainda
não estão conectados — o webhook de recibos não foi publicado. O texto acima
não afirma que eles estão: diz que os sets existem para atribuição por produto,
o que é verdade. Não prometa monitoramento de eventos em tempo real enquanto o
webhook não estiver no ar.

## O caminho de envio está provado de ponta a ponta

Com a credencial do app (não a de administrador), contra o SES real:

| Teste | Resultado |
|---|---|
| Enviar de `contato@mkt.venn360.com` pelo set `venn-odontobox` | ✓ aceito, `MessageId 010f01a1bb4569a3-…` |
| A mesma chave usando o set `venn-stagent` | ✓ **barrado**: `AccessDeniedException: User 'venn-ses-odontobox' is not authorized to perform 'ses:SendEmail' on resource '…configuration-set/venn-stagent'` |

O segundo fecha a prova que antes ficou inconclusiva: o isolamento entre apps é
real, e não três nomes apontando para o mesmo poder. Ele só foi possível depois
de haver um remetente verificado — antes disso o SES recusava por domínio não
verificado **antes** de chegar na checagem do IAM, e o teste não dizia nada.

O destinatário foi `success@simulator.amazonses.com`, a caixa de simulação da
AWS: aceita no sandbox sem verificação, e não conta como entrega nem suja
reputação.
