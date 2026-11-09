# Instruções do projeto

## Onde este sistema roda

**Cloudflare.** O app é Next sobre Workers (`cloudflare.config.ts`, publicado pela
Cloudflare Builds no merge em `main`), o banco é Postgres no Neon, as filas são
Cloudflare Queues, o estado por conversa vive em Durable Objects e o e-mail
**transacional** sai pelo binding `send_email` do Cloudflare Email Sending.

Isso não muda. Se um roteiro, uma skill ou uma ferramenta sugerir "fazer o deploy
na AWS", a resposta é não — a AWS entra aqui por **um** motivo, e só um.

## A AWS entra só pelo SES, e só para campanha

| | Transacional | Campanha |
|---|---|---|
| O que é | senha, convite, cobrança, alerta | mail marketing, funil |
| Por onde sai | **Cloudflare Email Sending** (`env.EMAIL`) | **Amazon SES** |
| Remetente | `noreply@mail.venn360.com` (nosso) | o domínio do **cliente** |
| Código | `src/lib/email/send.ts` | `src/lib/email/ses.ts` |

### Por que campanha não cabe na Cloudflare

A campanha tem de sair do domínio do cliente, e o Email Sending exige que o
domínio de envio seja **zona da nossa conta** ("you must be using Cloudflare DNS
to use Email Service"); adicionar só `mkt.clinica.com.br` como zona é recurso
Enterprise. O caminho restante seria a clínica delegar os nameservers do domínio
inteiro para nós — passaríamos a responder pelo site e pelo MX dela.

E a cota do Email Sending é **da conta**, não do domínio: todos os clientes
dividiriam o mesmo balde, junto com a recuperação de senha.

No SES o cliente publica três CNAME de DKIM na zona que já tem, e a reputação
fica no domínio dele — quem importa lista comprada queima o próprio domínio, não
o dos outros.

### Os parâmetros da conta AWS

| | |
|---|---|
| Conta | uma só, servindo aos três apps |
| Região | **`us-east-2`** |
| Perfil da CLI | `venn360` |
| Configuration set | um por app — aqui, `venn-odontobox` |
| Credencial | um usuário IAM por app, com quatro ações |

**Região é parte da identidade do SES.** Domínio verificado, configuration set,
cota e estado de sandbox são todos por região: criar em `us-east-1` e apontar o
código para `us-east-2` dá `NotFoundException` sem dizer por quê. A **exceção** é
o próprio Agent Toolkit da AWS, que só existe em `us-east-1`.

O passo a passo para gerar credenciais está em
[`infra/runbook/17-ses-credenciais.md`](infra/runbook/17-ses-credenciais.md)
— ele atravessa os três produtos, e por isso mora no runbook e não em `docs/`. As quatro ações do IAM
saem dos quatro endpoints que `src/lib/email/ses.ts` chama — não há um quinto, e
acrescentar permissão "por via das dúvidas" é o oposto do que esse arquivo
documenta.

### O que **não** fazer com a AWS aqui

- **Não** hospedar nada lá: nem Lambda, nem S3, nem RDS, nem CloudFront. O
  armazenamento de objeto é R2/Magalu por `src/lib/storage/s3.ts` (que fala S3
  mas não aponta para a AWS).
- **Não** dar à aplicação permissão de configuração de conta
  (`CreateConfigurationSet` e afins). O configuration set é criado uma vez, à
  mão; a aplicação só envia, verifica identidade e suprime.
- **Não** trocar o transacional para o SES. São dois caminhos de propósito: se o
  domínio de marketing de um cliente afundar, a recuperação de senha continua
  saindo.

### Provar o SES sem Worker

```bash
npx tsx --conditions=react-server scripts/testar-ses.ts --para voce@exemplo.com --de contato@dominio-verificado
```

É o único pedaço desta feature que se prova nesta máquina — fila, cron e disparo
precisam de staging, porque o workerd não roda aqui.
