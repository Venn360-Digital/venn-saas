# Credenciais do SES — uma por app

**Para quê:** o envio de **campanha** de e-mail sai pelo Amazon SES, pelo domínio
de cada cliente. O e-mail **transacional** continua no Cloudflare Email Sending e
nada aqui o toca.

Por que SES e não Cloudflare: ver o cabeçalho de `src/lib/email/ses.ts`.

---

## A decisão que precede os passos: uma conta AWS, três usuários IAM

O pedido é "uma credencial por app". Isso se faz com **três usuários IAM dentro de
uma conta AWS só** — não com três contas AWS.

| | Uma conta, 3 usuários IAM | Três contas AWS |
|---|---|---|
| Sair do sandbox | **uma vez** | três vezes, 96 h cada |
| Cota diária | **compartilhada** pelos 3 apps | separada por app |
| Reputação por domínio do cliente | isolada (é por domínio) | isolada |
| Fatura | uma | três |
| Credencial por app | sim, usuário IAM próprio | sim |

**O que você perde:** a cota diária de envio é **da conta e da região**, então os
três apps dividem o mesmo teto. Enquanto o volume for de dezenas de milhares por
mês isso não aperta, e pedir aumento uma vez é melhor que pedir três.

**O que você não perde:** a reputação que importa é a **do domínio de cada
cliente**, porque é ele que assina o DKIM. Uma clínica que queima o domínio dela
não afeta as outras — nem no mesmo app, nem nos outros dois. É o motivo de todo o
desenho (ver `EmailSender` no schema).

**Região: `sa-east-1` (São Paulo).** O dado de contato fica no país, e a latência
não importa porque todo envio passa pela fila.

---

## Passo 1 — Conta AWS e a região

1. Entre no [console da AWS](https://console.aws.amazon.com/).
2. No canto superior direito, troque a região para **América do Sul (São Paulo)
   `sa-east-1`**.

   > A região é parte da identidade do SES: identidade verificada, configuration
   > set, cota e estado de sandbox são **por região**. Criar em `us-east-1` e
   > apontar o código para `sa-east-1` dá "NotFoundException" sem dizer por quê.

---

## Passo 2 — Um configuration set por app

O configuration set é o que faz os eventos (entrega, abertura, clique,
reclamação) voltarem para nós. **Sem ele, o envio sai e nenhum recibo chega.**

No console: **Amazon SES → Configuration sets → Create set**. Crie os três:

| App | Nome do configuration set |
|---|---|
| OdontoBox360 | `venn-odontobox` |
| Stagent | `venn-stagent` |
| Conecta | `venn-conecta` |

Deixe o resto no padrão. O destino de evento (SNS) entra depois, quando o webhook
de recibos estiver publicado — o envio já funciona sem ele, só não traz métrica.

Pela CLI, se preferir:

```bash
for app in odontobox stagent conecta; do aws ses create-configuration-set --configuration-set "Name=venn-$app" --region sa-east-1; done
```

---

## Passo 3 — A política de permissões

Crie **uma política por app**. É o que faz "uma credencial por app" significar
alguma coisa: cada usuário só envia pelo configuration set do app dele.

No console: **IAM → Policies → Create policy → JSON**. Nome sugerido:
`venn-ses-odontobox` (e assim para os outros).

Troque `SEU_ID_DE_CONTA` pelo número de 12 dígitos da conta, e `odontobox` pelo
slug do app:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnviarPeloConfigurationSetDesteApp",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": [
        "arn:aws:ses:sa-east-1:SEU_ID_DE_CONTA:identity/*",
        "arn:aws:ses:sa-east-1:SEU_ID_DE_CONTA:configuration-set/venn-odontobox"
      ]
    },
    {
      "Sid": "VerificarDominioDeCliente",
      "Effect": "Allow",
      "Action": ["ses:CreateEmailIdentity", "ses:GetEmailIdentity"],
      "Resource": "arn:aws:ses:sa-east-1:SEU_ID_DE_CONTA:identity/*"
    },
    {
      "Sid": "SuprimirQuemReclamouOuNaoExiste",
      "Effect": "Allow",
      "Action": "ses:PutSuppressedDestination",
      "Resource": "*"
    }
  ]
}
```

### Por que exatamente estas quatro ações, e nenhuma a mais

São os quatro endpoints que `src/lib/email/ses.ts` chama. Não há um quinto:

| Ação | Chamada no código | Para quê |
|---|---|---|
| `ses:SendEmail` | `POST /v2/email/outbound-emails` | mandar a campanha |
| `ses:CreateEmailIdentity` | `POST /v2/email/identities` | registrar o domínio do cliente e receber os 3 tokens de DKIM |
| `ses:GetEmailIdentity` | `GET /v2/email/identities/{domínio}` | o cron horário perguntando se o DKIM já apareceu |
| `ses:PutSuppressedDestination` | `PUT /v2/email/suppression/addresses/{e-mail}` | bloquear quem reclamou de spam ou cujo endereço não existe |

**O que ficou de fora de propósito:** `ses:CreateConfigurationSet` e
`ses:CreateConfigurationSetEventDestination`. A primeira versão do código criava
um configuration set por unidade, o que exigiria essas duas — poder de
configuração de conta no caminho de uma requisição HTTP. Com um set por app,
criado aqui à mão uma vez, a aplicação nunca precisa desse poder.

`ses:PutSuppressedDestination` fica com `Resource: "*"` porque a lista de
supressão é da conta e não tem ARN por item — é a única que não dá para
restringir.

---

## Passo 4 — Um usuário IAM por app

Para cada app, em **IAM → Users → Create user**:

1. **Nome:** `venn-ses-odontobox` (idem para `stagent` e `conecta`).
2. **NÃO** marque "Provide user access to the AWS Management Console". Esta
   credencial é de programa; não existe gente que precise entrar com ela.
3. **Permissions → Attach policies directly →** escolha a política do Passo 3
   correspondente a este app.
4. Criado o usuário, abra-o → **Security credentials → Access keys → Create
   access key**.
5. Em "Use case", escolha **Application running outside AWS**.
6. Guarde o **Access key ID** e o **Secret access key**.

> **O segredo aparece uma vez só.** Fechou a tela sem copiar, não tem como ver de
> novo — só criar outra chave e apagar a anterior. Copie as duas antes de fechar.

Pela CLI:

```bash
aws iam create-user --user-name venn-ses-odontobox
```

```bash
aws iam attach-user-policy --user-name venn-ses-odontobox --policy-arn arn:aws:iam::SEU_ID_DE_CONTA:policy/venn-ses-odontobox
```

```bash
aws iam create-access-key --user-name venn-ses-odontobox
```

---

## Passo 5 — Gravar nos Workers

Três segredos e duas variáveis de texto, **por app**. Os segredos vão por
`wrangler secret`, que não os escreve em arquivo nenhum:

```bash
npx wrangler secret put SES_ACCESS_KEY_ID --name odontobox
```

```bash
npx wrangler secret put SES_SECRET_ACCESS_KEY --name odontobox
```

Cada comando pede o valor e o lê da entrada padrão. Repita trocando `--name` por
`odontobox-stg`, `stagent`, `stagent-stg`, `conecta`, `conecta-stg` — **seis
Workers no total**, com a chave do app correspondente.

> **Homologação usa a mesma chave do app?** Sim, e de propósito: é a mesma conta
> AWS e o mesmo configuration set. O que separa produção de homologação aqui é o
> banco, não a credencial. Se um dia quiser separar de verdade, crie um
> configuration set `venn-odontobox-stg` e um usuário próprio.

`SES_REGION` e `SES_CONFIGURATION_SET` têm padrão no código (`sa-east-1` e
`venn-<slug>`), então **só precisam ser declarados se você fugir da convenção**.

### As duas armadilhas já registradas

1. **Segredo gravado não serve no ato.** O `wrangler secret put` responde
   "Success" antes de a borda servir o valor novo. Esperar um minuto e refazer o
   deploy é mais rápido que investigar um 503.
2. **Preview não herda segredo de produção.** Um PR com preview não vai enxergar
   estas chaves a menos que elas estejam na configuração base. É desenho, não
   defeito — e é por isso que a rota responde **503 "não configurado"** em vez de
   500 quando a credencial falta.

---

## Passo 6 — Tirar do sandbox (o que trava o volume)

Enquanto a conta estiver em sandbox: **200 e-mails por dia, 1 por segundo, e só
para endereço verificado**. Dá para construir e provar; não dá para vender.

Console: **Amazon SES → Account dashboard → Request production access**. Ou:

```bash
aws sesv2 put-account-details --production-access-enabled --mail-type MARKETING --website-url https://odontobox360.com --additional-contact-email-addresses andre@venn360.com --contact-language EN --region sa-east-1
```

**Uma vez só** — o pedido é da conta, não do usuário IAM, então vale para os três
apps.

`--mail-type MARKETING` é o correto e importa: declarar `TRANSACTIONAL` para
depois disparar campanha é o tipo de divergência que a AWS usa para suspender
conta. A resposta inicial vem em **até 96 horas**.

Quando perguntarem como você trata bounce e reclamação, a resposta é verdadeira e
está no código: bounce duro e reclamação gravam `Contact.emailOptOutAt` e entram
na lista de supressão do SES; todo e-mail leva `List-Unsubscribe` com
`List-Unsubscribe-Post` (RFC 8058) e um link de descadastro no rodapé, que
funciona sem login em `/descadastro/[token]`.

---

## Conferir que funcionou

Com as chaves no ambiente, deste repositório:

```bash
npx tsx --conditions=react-server scripts/testar-ses.ts --para seu-email@exemplo.com --de contato@seu-dominio-verificado.com.br
```

No sandbox, o destinatário precisa estar verificado — verifique o seu primeiro em
**SES → Identities → Create identity → Email address**.

Estado da conta, incluindo cota e sandbox:

```bash
aws sesv2 get-account --region sa-east-1
```
