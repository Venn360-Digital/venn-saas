# 21 · Homologar a cobrança no sandbox do Asaas

Roteiro para provar o caminho de dinheiro em **homologação**, com a chave de
sandbox. Mora no runbook e não em `docs/` pela mesma razão do
[17](./17-ses-credenciais.md): atravessa os três produtos e depende de ações no
painel de um fornecedor.

Escrito em 27/11/2026, ao fechar as Fases 1, 2 e 5 do projeto de cobrança
embutida.

## Antes de começar: o que o CI não alcança

Três coisas vivem no painel do Asaas e **nenhum teste as pega**. Sem elas o
roteiro inteiro falha no passo 4, e o sintoma é o pior possível — cliente paga e
nada acontece.

| | onde | como saber que está certo |
|---|---|---|
| chave de API de sandbox (`$aact_hmlg_`) | cofre do Worker `-stg` | o passo 2 gera o QR |
| **token do webhook** | painel do Asaas → Webhooks → AccessToken | idêntico a `PLATFORM_ASAAS_CLIENT_SECRET` |
| **eventos de Checkout marcados** | painel do Asaas → Webhooks | o passo 5 ativa o plano |

> O token é um valor que **nós inventamos** e colamos no painel — não é a chave
> de API. Confundi-los custou uma tarde em 27/11/2026. Gere com
> `openssl rand -hex 16` e ponha o mesmo valor nos dois lados.

**`wrangler secret list` prova o nome, nunca o valor.** Um marcador posto só para
o deploy passar aparece como presente e não serve.

## 0 · Preparar a conta de homologação

Comprar adicional exige plano **ativo** (`canBuyAddons`), e contratar exige
avaliação correndo ou vencida. Confira no banco de `staging` qual é o estado
antes de escolher o passo:

```sql
select a."billingExempt", a."cpfCnpj" is not null as tem_doc, a."asaasCustomerId",
       s.status, s.plan, s."trialEndsAt", s."readOnlySince"
from accounts a left join subscriptions s on s."accountId" = a.id;
```

- `billingExempt = true` → **nada é cobrado**. Vire para `false` ou o roteiro
  passa reto pelo gateway.
- os oito campos de cobrança vazios → o diálogo de dados abre antes do pagamento
- `asaasCustomerId` nulo → o Pix embutido recusa com 409, por desenho: `POST
  /payments` exige `customer`

O nome do banco **não é o mesmo nos três projetos** Neon — ver
[`staging-publicado`](./15-arquitetura-cicd-github-workers-builds.md) e o
`database_name` de cada um.

## 1 · A sonda de credencial (Fase 1)

Ela roda sozinha às **09:14 UTC**. Para não esperar, invoque o cron à mão no
Worker `-stg` e leia o log:

- credencial boa → `CRON:ASAAS-CREDENCIAL  credencial do Asaas ok (api-sandbox.asaas.com (sandbox)/myAccount/commercialInfo)`
- credencial ruim → um e-mail para `ALERT_EMAIL` com o conserto e o nome do
  Worker **com sufixo `-stg`**

Prova negativa, e vale fazer uma vez: grave um valor inválido na chave, rode, e
confira que o e-mail chega dizendo "sem chave legível". Depois reponha. É a
única forma de saber que o alerta sai.

## 2 · Pix embutido (Fase 2)

Conta → Assinatura → **Comprar adicionais** → escolha crédito ou unidade →
Confirmar → forma de pagamento **Pix**.

O que tem de acontecer:

1. o diálogo abre **sem sair do domínio** — sem janela nova, sem página do Asaas
2. QR Code visível, com fundo claro **nos dois temas** (teste no escuro — é o
   caso que o `lint:colors` discutiu)
3. **Copiar código** põe o copia-e-cola na área de transferência
4. valor igual ao da cesta, e validade escrita
5. a linha nasce no banco: `select status, "valueCents", "asaasCheckoutId" from
   asaas_checkouts order by "createdAt" desc limit 1` → `ACTIVE`, id começando
   com `pay_`

Se o QR não aparecer e o copia-e-cola sim, a segunda chamada ao Asaas falhou e a
cobrança **continua válida** — é o caminho previsto, não defeito.

## 3 · Pagar o Pix no sandbox

No sandbox do Asaas há uma tela para confirmar pagamento de QR Code. Pague.

O diálogo tem de andar **sozinho**, sem recarregar:

- "Pagamento recebido — liberando o adicional" (o webhook gravou `paidAt`)
- depois a confirmação verde (o webhook gravou `appliedAt`)

A sondagem é de 3 em 3 segundos e para em 10 minutos. Se passar disso, a tela
diz que parou de verificar — e o adicional entra de todo jeito.

## 4 · Conferir a entrega no banco

```sql
select status, "paidAt" is not null as pago, "appliedAt" is not null as entregue
from asaas_checkouts order by "createdAt" desc limit 1;

select credits, "creditsUsed" from subscriptions;
select count(*) from credit_purchases;  -- ou unit_addons, conforme a compra
```

`appliedAt` nulo com `paidAt` preenchido significa que o webhook chegou e a
entrega falhou — procure o erro em `asaas_events.error`.

**`asaas_events` com zero linhas é o sintoma de webhook**: ou o token não bate
(401), ou a fila está pausada. Ver passo 6.

## 5 · Contratar plano (o caminho do checkout hospedado)

Este ainda sai do domínio, de propósito — o cartão não passa por aqui
(`PRODUCT.md` §13). Numa conta em avaliação:

1. a faixa de aviso → **Assinar agora** deve cair direto na página do Asaas, com
   o nome do plano e o valor
2. o cartão do plano escolhido no cadastro deve dizer **"Escolhido" / "Assinar
   agora"**, clicável — nunca "Plano atual" apagado
3. pagar com [cartão de teste do Asaas](https://docs.asaas.com/docs/cartoes-de-credito-para-testes),
   **nunca** um cartão real
4. o retorno diz "Pagamento recebido, aguardando confirmação"
5. o `CHECKOUT_PAID` ativa: `status = active`, `readOnlySince = null`,
   `asaasSubscriptionId` e `asaasCustomerId` preenchidos, `credits` na franquia
   do plano e **`creditsUsed` preservado**

O passo 5 é o que depende dos **eventos de Checkout** estarem marcados. Com
webhook só de cobranças, os `PAYMENT_*` chegam, o plano não ativa, e parece
defeito de código.

## 6 · Quando o webhook não chega

Diagnóstico pelo status **e pela presença da linha de log** — a ausência é
informação:

| no `wrangler tail` | o que é |
|---|---|
| `HTTP 401` **com** `[ASAAS_WEBHOOK] nenhum token registrado` | o Worker não lê o segredo |
| `HTTP 401` **sem** linha de log | o Worker leu e o painel manda outro valor |
| nada chegando | URL errada, ou fila pausada |

```bash
npx wrangler tail odontobox-stg --format json
```

O Worker é **argumento posicional** — `--name` não existe em `tail` (existe em
`secret put`). E filtrar por `outcome` não serve: `ok` só diz que o Worker não
lançou, e um 401 também é `ok`. Filtre por `event.response.status`.

**Fila pausada** (15 falhas consecutivas) só volta por ação manual no painel, e
é **por webhook**: criar outro não recupera o represado. Reativar é seguro —
`asaasEventId` é único e a segunda chegada do mesmo evento é sucesso.

## O que este roteiro não cobre

**Pix no plano mensal.** Não existe: o Asaas recusa Pix em operação recorrente.
Plano em Pix é **Pix Automático**, com autorização confirmada pela instituição do
pagador, e é fase própria.

**Cartão embutido.** Parado por decisão de escopo de PCI — ver `PRODUCT.md` §13.

**Segundo pagamento simultâneo.** Nada impede hoje criar um segundo checkout com
um pendente, e dois pagos geram duas assinaturas no Asaas. Está registrado como
tarefa à parte.
