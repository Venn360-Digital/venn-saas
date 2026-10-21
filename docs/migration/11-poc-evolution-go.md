# POC — Evolution Go em Cloudflare Containers

> Executada em **2026-10-21**. Worker `poc-canal-whatsapp`, conta Venn360,
> imagem `docker.io/evoapicloud/evolution-go:0.7.2`, instância `lite`.
> Código em [`poc/canal-whatsapp/`](../../poc/canal-whatsapp/), decisões em
> [`src/decisoes.ts`](../../poc/canal-whatsapp/src/decisoes.ts), testes em
> `npm run check:canal`.

O [`01-compatibility.md` §11](01-compatibility.md) chamou este componente de
**maior risco técnico da migração**, com esta frase:

> Levar para um runtime com scale-to-zero um componente que já perde sessão com
> o processo sempre de pé é o maior risco técnico desta migração.

A POC confirma que a desconfiança estava certa, e **erra o alvo**. O
scale-to-zero é recusável. O que barra o caminho é outra coisa, que nenhum
documento desta migração previu: **uma licença**.

---

## 1. O que a POC encontrou e ninguém tinha previsto

### 1.1 O Evolution Go exige ativação de licença, e sem ela não nasce QR

Primeira chamada a `/instance/create` num contêiner novo:

```json
{
  "code": "LICENSE_REQUIRED",
  "error": "service not activated",
  "message": "License required. Open the manager to activate your license."
}
```

A licença é **gratuita** — tier comunidade, sem limite de instância ou de
mensagem — mas a ativação é obrigatória e é feita **por uma pessoa**, num painel
web (`/manager`), com login pela chave global. Está documentada em
[`infra/README.md`](../../infra/README.md); o que não estava em lugar nenhum é a
consequência para esta migração: **toda implantação nova do Evolution Go nasce
inerte**, e nenhum passo do runbook ativava a nova.

### 1.2 E isso abre um buraco no corte

O passo A.3 do [`02-runbook.md`](02-runbook.md) despeja **só o banco
`postgres`**. O Evolution Go tem dois bancos próprios, `evogo_auth` e
`evogo_users`, e nenhum dos dois estava no dump.

O que isso custaria no corte, se não fosse corrigido:

| O que fica para trás | Sintoma no dia seguinte |
| --- | --- |
| A ativação da licença | `/instance/create` responde 503; nenhum QR nasce |
| O estado do whatsmeow (`evogo_users`) | **toda clínica tem de parear de novo**, uma por uma, lendo QR |

Nenhum dos dois aparecia na tabela de passos nem na lista de reversão. O runbook
foi corrigido nesta rodada — ver [§5](#5-o-que-mudou-no-runbook).

E há um ganho junto com a correção: como o estado do whatsmeow mora em Postgres
e não em volume, **migrar os dois bancos preserva os pareamentos**. O
re-pareamento deixa de ser um passo obrigatório do corte e passa a ser plano B.

### 1.3 O heartbeat da licença manda o IP do servidor

`infra/README.md` registra que a instância ativada envia batimentos periódicos
com "versão, contadores agregados, funcionalidades ativas, **IP do servidor**".

Em Containers o IP de saída é da Cloudflare e **muda a cada subida**. Com um
contêiner por workspace e um contorno que reinicia de propósito, o número de IPs
distintos vistos pelo fornecedor cresce rápido. O tier comunidade declara não ter
limite de instância, então provavelmente não há vínculo por IP — mas isto é
**dependência de terceiro que não se afirma por leitura de documentação**. Está
em [`00-open-decisions.md`](00-open-decisions.md) como pergunta ao fornecedor.

---

## 2. Os sete critérios

| # | Critério | Situação |
| --- | --- | --- |
| 1 | Instância sobe e gera QR legível | 🟡 contêiner sobe e fica `healthy`; QR barrado pela licença |
| 2 | Pareia e **mantém** a sessão (os 105 s) | ⬜ depende da ativação e de um aparelho |
| 3 | Recebe e emite webhooks | 🟡 caminho construído e tranca provada; evento real pendente |
| 4 | Credenciais fora de disco efêmero | ✅ **provado por construção** |
| 5 | Sobrevive a reinício | 🟡 mecanismo construído; não exercitado com sessão |
| 6 | Sobrevive a período sem tráfego | ✅ **resolvido — e a medição explica por quê** |
| 7 | Custo pela política real de execução | ✅ calculado |

### Critério 4 — credenciais fora do disco: provado sem rodar nada

O `evolution-go` do compose **não tem volume nenhum** (o `evolution-v2`, ao
lado, tem `evolution-v2-instances`). O procedimento de deploy recria o contêiner,
e os dois vigias do host o reiniciam rotineiramente — e a ativação é "uma vez
só" e sobrevive a tudo isso. Logo a ativação e o estado do whatsmeow **já moram
no Postgres hoje**, não no disco.

Isso vale duas coisas: o disco efêmero dos Containers não tira nada, e o
`snapshot` de contêiner — recurso que existe desde setembro/2026 — **não é
necessário**. Um recurso a menos na superfície.

### Critério 6 — o scale-to-zero é recusável, e a medição mostra que tem de ser

Duas medições e um fato de plataforma.

**O fato:** a documentação do `Container` é explícita — se `onActivityExpired()`
não chamar `stop()`, o cronômetro renova e o gancho dispara de novo. Permanecer
de pé é caminho previsto, não truque.

**A medição que decide:** arranque a frio de um contêiner novo, duas amostras —
**39,9 s e 25,0 s**. Uma sessão de WhatsApp que hibernasse estaria fora do ar
nesse intervalo, e o soquete caído não enfileira mensagem: o aparelho aparece
como desconectado. Então não é "melhor não hibernar" — é **não pode**.

**O desenho:** a recusa é condicional de propósito
([`decidirOcio`](../../poc/canal-whatsapp/src/decisoes.ts)):

- workspace com aparelho pareado → **permanece**;
- pareamento em curso → **permanece**;
- sem sessão → **dorme**.

É o que faz a conta seguir o número de clientes reais em vez do de cadastros.

> **Um erro meu, encontrado aqui.** A primeira versão do vigia rondava a cada
> 5 min consultando o contêiner, contra um `sleepAfter` de 10 min. Consulta ao
> contêiner conta como atividade: a ronda **renovava o cronômetro** e mantinha de
> pé — e cobrando — exatamente os contêineres que `decidirOcio` mandava dormir.
> O vigia agora encerra quando não há sessão pareada, e volta pelo `onStart` da
> próxima subida. Sem essa correção a POC teria "passado" enquanto a fatura
> crescia em silêncio.

### Critério 7 — custo

Contêiner sempre ligado, preços de 2026-10-21, já descontada a franquia do
Workers Paid (25 GiB-h de memória, 375 vCPU-min, 200 GB-h de disco):

| Instância | ×1 | ×5 | ×10 | ×25 | ×50 |
| --- | --- | --- | --- | --- | --- |
| `lite` (256 MiB) | **US$ 1,74** | 10,15 | **21,02** | 53,64 | 108,01 |
| `basic` (1 GiB) | 7,24 | 39,09 | 78,90 | 198,35 | 397,42 |

**O Evolution Go sobe e fica `healthy` em `lite`** — 1/16 de vCPU e 256 MiB.
Essa medição vale quatro vezes na conta, e foi feita do jeito mais barato
possível: começando pela menor instância que existe e deixando a falha ser a
medida. Não falhou.

Falta somar o que o canal força no Neon: uma sessão sempre no ar mantém conexões
abertas, e **o compute do Neon nunca suspende**. A 0,25 CU são ~182 CU-h/mês.
Medido hoje: o compute de `production` estava `idle` e o de `staging` `active`,
justamente porque a POC estava conectada.

**Onde a conta vira:** por workspace, `lite` ganha da VPS até algo entre 15 e 25
clínicas pareadas. Depois disso o modelo compartilhado (um contêiner para todos,
como na VPS hoje) fica mais barato — ao preço de voltar a ter o raio de alcance
grande descrito em [§3](#3-um-contêiner-por-workspace-e-por-quê). A decisão não é
de agora: ela chega com a 15ª clínica, e está registrada para quando chegar.

---

## 3. Um contêiner por workspace, e por quê

Na VPS há **um** Evolution Go para todos os workspaces. O contorno do defeito de
pareamento é reiniciar o processo — e reiniciar para consertar a sessão de um
cliente derruba a de **todos**. Com três clínicas isso é um susto; com trinta é
um defeito de produto que cresce sozinho.

A POC usa um contêiner por workspace (`getContainer(env.CANAL, workspace)`), e o
reinício passa a atingir só quem acabou de parear.

E há uma diferença de fundo, não de grau. O contorno na VPS mora no host, num
daemon que lê `docker logs -f` e chama `docker restart`. O
[`wa-pool-guard.sh`](../../infra/scripts/wa-pool-guard.sh) explica por que não
foi para o worker:

> para o worker reiniciar um contêiner vizinho seria preciso montar o socket do
> Docker dentro dele, o que dá ao código da aplicação controle sobre o host
> inteiro. Caro demais para um contorno de bug de terceiro.

Em Containers essa objeção desaparece: o Durable Object tem autoridade sobre **o
seu próprio** contêiner e sobre nenhum outro. O contorno continua sendo contorno,
mas deixa de ser perigoso — e sai do host, onde ninguém versiona, para o
repositório, onde tem teste.

O `PairSuccess` também chega melhor: na VPS era preciso descobri-lo lendo log;
aqui ele entra como webhook pela porta da frente.

---

## 4. O que ainda não se sabe

| Pergunta | Como se responde | Quem |
| --- | --- | --- |
| A ativação sobrevive a contêiner novo? | Ativar e subir um segundo contêiner apontando ao mesmo `evogo_auth` | depois da ativação |
| O Evolution Go funciona no **pooler** do Neon? | **Não provado.** `/server/ok` fica verde sem banco — é o próprio sintoma de produção. A licença barrou antes de a migração de esquema rodar | depois da ativação |
| O vazamento de conexões mata o Neon? | 112 conexões a 0,25 CU. Se o pooler servir, ele absorve; se não, o teto é mais baixo que o da VPS | depois da ativação |
| Os 105 s acontecem aqui? | Parear e observar o diário | André + aparelho |
| O `0.7.2-beta` corrigiu o laço de QR? | Trocar a tag na POC e repetir | depois do caso base |
| A licença se incomoda com IP que muda? | Perguntar ao fornecedor | André |

> **Sobre o pooler.** Usei o endpoint *pooled* de propósito: o segundo defeito
> medido é vazamento de conexões até esgotar `max_connections`, e é exatamente
> isso que o PgBouncer absorve. Mas o pooler do Neon é modo transação, e
> migração de esquema costuma tropeçar nele. Se tropeçar, o caminho é o endpoint
> direto — e aí o vazamento volta a ser risco de primeira ordem, porque o teto do
> Neon a 0,25 CU é **mais baixo** que o dos 100 da VPS.

### Para produção, a imagem não vem do Docker Hub

A POC puxa `docker.io/evoapicloud/evolution-go:0.7.2` direto — é o que permitiu
publicar deste Mac, que **não tem Docker**. Mas a Cloudflare não faz cache de
imagem do Docker Hub, e o Docker Hub tem limite de pull. Em produção a imagem vai
para o registro da Cloudflare, o que exige Docker — ou seja, **no CI**, que roda
em Linux. É mais um motivo para o `build:vinext` do CI existir.

E a tag vai **fixada**. A VPS roda `:latest` há meses; hoje `:latest` é idêntico
a `0.7.2` pelo digest, mas uma publicação do autor muda o comportamento sem
ninguém pedir.

---

## 5. O que mudou no runbook

1. **A.3** passa a despejar `evogo_auth` e `evogo_users` além de `postgres`.
2. **Novo passo 5b**: restaurar os dois no Neon, antes de publicar o Worker.
3. **Novo passo 8b**: conferir que `/instance/create` responde (prova de que a
   licença veio no dump) e que as sessões voltaram sem QR.
4. **Reversão**: se as sessões não voltarem, o plano B é re-parear clínica por
   clínica — e isso precisa de janela, não cabe nos 30 min de observação.

---

## 6. Veredito

**Tecnicamente viável, e sem precisar da saída de emergência.** O item 6, o
decisivo, se resolve com um gancho que a plataforma documenta — e a medição do
arranque a frio mostra que resolvê-lo é obrigatório, não opcional. Não é preciso
hospedar o Evolution Go fora da Cloudflare, e a VPS pode desaparecer inteira.

Dois poréns, e nenhum é de plataforma:

1. **A ativação da licença é um ato humano** e entra no caminho crítico do corte.
   O caminho está pronto — `/manager` sai pelo Worker, sem o túnel SSH que a VPS
   exigia. Falta o ato.
2. **O custo cresce por clínica pareada.** Em `lite` é US$ 1,74 cada, o que é
   barato agora e vira decisão perto da 15ª.

O que a POC devolve de mais valioso não é o veredito: é o buraco no corte. O
dump não levava a licença nem os pareamentos, e o sintoma teria aparecido
**depois** do DNS apontado, com as clínicas já no ar novo e sem WhatsApp.
