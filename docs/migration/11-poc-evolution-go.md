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

### 1.2 E tem saída por configuração — a licença não precisa migrar

Do [`.env.example`](https://github.com/evolution-foundation/evolution-go/blob/main/.env.example)
do projeto, literal:

> `# License — headless auto-activation by email.`
> `# Set this to the email you used in your first manual license registration.`
> `# On startup, the service will silently call /v1/register/auto and skip the`
> `# browser flow. Falls back to the manual flow if the email isn't registered yet.`
> `# EVOLUTION_OPERATOR_EMAIL=operator@example.com`

Isso muda o problema de categoria. A licença deixa de ser **estado num banco
que precisa ser migrado** e passa a ser **configuração num segredo**:

| | Antes | Com `EVOLUTION_OPERATOR_EMAIL` |
| --- | --- | --- |
| Ativar implantação nova | pessoa no `/manager`, por túnel SSH | sozinho, ao subir |
| `evogo_auth` no corte | tem de ser migrado | **pode nascer vazio** |
| Ato humano no caminho crítico | sim | **não** |

Um registro manual ainda acontece **uma vez**, com um e-mail — e já aconteceu,
porque a VPS está ativada. O que o e-mail faz é tornar esse registro
reaproveitável por toda implantação seguinte.

E preencher errado é inofensivo: cai no fluxo manual, que é o comportamento de
hoje.

### 1.2.1 E isso abre um buraco no corte

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

### 1.3 As duas bases moram num Postgres separado, de propósito

Descoberto em 2026-10-21, depois de o diagnóstico na VPS falhar com
`database "evogo_auth" does not exist`. A causa foi minha: analisei
`infra/compose.yaml`, e a VPS roda **`compose.staycloud.yaml`** — o primeiro é
explicitamente a variante que não se implanta lá.

O arquivo certo diz, em comentário:

> as duas bases vivem na instância `postgres`, não na `supabase-db` — credenciais
> de sessão do WhatsApp são o alvo de maior valor nesta máquina e não têm por que
> compartilhar servidor com o dado clínico.

É isolamento deliberado, e **o desenho da migração o desfazia em silêncio**:
`evogo_auth` e `evogo_users` foram criados na mesma branch Neon do banco da
aplicação. Funciona, e joga fora uma decisão de segurança que alguém tomou.

Não é purismo. A credencial de aparelho do whatsmeow permite **assumir o
WhatsApp da clínica** — mandar mensagem como ela, ler o que chega. Compartilhar
servidor com o dado clínico significa que comprometer um alcança o outro.

A correção é projeto Neon próprio para as duas bases. O preço é um compute a
mais sempre ligado (~US$ 25/mês a 0,25 CU, porque o Evolution Go mantém conexão
aberta e o compute nunca suspende) e entra na conta de
[§2 critério 7](#critério-7--custo). Decisão do André se quiser economizar isso
aceitando o compartilhamento; o padrão é preservar o que já estava separado.

Dois detalhes do arquivo certo que também corrigem o relatório:

- o limite de memória na VPS é **384 MB**, não ilimitado. A POC rodou `healthy`
  em `lite` (256 MiB) **sem sessão pareada** — com uma sessão real, 256 MiB pode
  não bastar, e aí a conta dobra para `basic`. Medir no pareamento.
- o `LICENSE_REQUIRED` estava **documentado no compose desde sempre**. Eu o
  apresentei como descoberta da POC; a POC descobriu a *consequência para o
  corte*, não o fato.

### 1.4 Levar a licença cria um risco novo, e ele é grave

Trazer a ativação da VPS resolve o 1.1 sem registrar nada de novo — a VPS já
está ativada, e a licença mora no Postgres. Mas os dois bancos do Evolution Go
**não têm o mesmo peso**:

| Banco | O que guarda | Copiar é |
| --- | --- | --- |
| `evogo_auth` | a licença | inofensivo a qualquer momento |
| `evogo_users` | credenciais de aparelho do whatsmeow | **perigoso com a VPS no ar** |

O WhatsApp aceita **uma conexão por aparelho vinculado**. Dois Evolution Go
sobre o mesmo `evogo_users`, os dois com `CONNECT_ON_STARTUP=true`, disputam o
mesmo aparelho: um derruba o outro em laço, e o desfecho provável é o WhatsApp
**desvincular o aparelho** — número da clínica fora do ar, exigindo justamente o
re-pareamento que levar as sessões existia para evitar.

Isso tem duas consequências, e as duas já estão aplicadas:

1. **No corte**, o passo 3 passa a parar o `evolution-go` junto com `app` e
   `worker`. Não custa indisponibilidade extra — o WhatsApp já está fora do ar
   no passo 3 — e sem isso o passo 5b viraria o defeito que ele veio consertar.
   É um risco que **a própria correção do dump criou**: enquanto as sessões não
   atravessavam, não havia com o que conflitar.
2. **Na POC**, `CONNECT_ON_STARTUP` virou a variável `REATAR_SESSOES`, e o
   padrão é **`false`**. A POC passou a poder apontar para base restaurada da
   VPS; com isto ligado, um teste tiraria número de clínica do ar.

O `infra/scripts/levar-licenca.sh` reflete a assimetria: leva `evogo_auth` por
padrão, e `evogo_users` só com `--sessoes` mais uma confirmação digitada.

### 1.5 O heartbeat da licença manda o IP do servidor

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
| 1 | Instância sobe e gera QR legível | 🟡 contêiner sobe e fica `healthy` em 25–40 s; QR barrado pela licença |
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

É o que faz a conta seguir o número de clientes reais em vez do de cadastros — e
o ramo "dorme" foi **observado em produção da POC**, não só testado: dos cinco
contêineres criados hoje, os que passaram do tempo sem pareamento desligaram
sozinhos. Ver o diário abaixo.

> **Um erro meu, e o diário que o pegou.** A primeira versão do vigia rondava a
> cada 5 min consultando o contêiner, contra um `sleepAfter` de 10 min. Consulta
> ao contêiner conta como atividade: a ronda **renovava o cronômetro** e mantinha
> de pé — e cobrando — exatamente os contêineres que `decidirOcio` mandava
> dormir. Sem a correção a POC teria "passado" enquanto a fatura crescia.
>
> O diário do contêiner `poc-1` registra o defeito e a cura na mesma linha do
> tempo, e serve como prova dos dois:
>
> ```
> 12:28:43  contêiner de pé
> 12:33:43  vigia: nada — sem sessão pareada      ← versão antiga: ronda e renova
> 12:38:43  vigia: nada — sem sessão pareada      ← renova de novo
> 12:43:43  vigia: encerrado — deixando hibernar  ← versão corrigida
> 12:53:40  ócio: dormir — nada a perder e nada a pagar
> 12:53:40  contêiner parou — código=0 razão=exit
> ```
>
> Os **dez minutos exatos** entre a última ronda e o `ócio: dormir` são o
> `sleepAfter` correndo sem ser renovado — ou seja, a medição confirma que a
> ronda antiga de fato segurava o cronômetro, e que parar de rondar o soltou.
> E `código=0 razão=exit` mostra que o Evolution Go trata o SIGTERM e sai
> graciosamente, o que importa para o contorno: é o desligamento limpo que
> devolve as conexões do Postgres.

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

### O compute do Neon não cabe no plano free, e isso decide a arquitetura

Medido em 2026-10-21, com os números da
[página de planos](https://neon.com/docs/introduction/plans):

| | |
| --- | --- |
| Compute mínimo sempre ligado | 0,25 CU × 730 h = **182,5 CU-hora/mês** |
| Franquia do plano free | **100 CU-hora por projeto** |
| Resultado | esgota por volta do **dia 16** |
| O que acontece ao esgotar | o compute é **suspenso** até o mês virar — não é cobrado, é desligado |
| No plano Launch | US$ 0,106/CU-hora, sem franquia → **US$ 19,34/mês** |

O Evolution Go mantém conexões de Postgres abertas enquanto tem sessão pareada,
e conexão aberta impede o compute de suspender. Então para uma clínica no ar o
compute fica 24/7, e 24/7 não cabe em 100 CU-hora.

**Isto é mais forte que o argumento de segurança para separar os bancos.** Se as
bases do Evolution ficarem no mesmo projeto do banco da aplicação, as conexões
dele prendem o compute **da aplicação** acordado — e por volta do dia 16 o
projeto inteiro é suspenso. Não é o WhatsApp que cai: é o sistema.

Então são dois projetos por necessidade, não por elegância.

> **Correção.** Escrevi aqui que "o projeto da aplicação, separado, pode
> suspender fora do horário comercial e caber na própria franquia". **Está
> errado como o sistema está configurado.** O Neon documenta que *scheduled jobs
> (like cron tasks)* também prendem o compute acordado, e o Worker tem um
> disparo `* * * * *` — `activity-reminders` mais a varredura da outbox. O
> projeto da aplicação fica 24/7 pelo mesmo motivo, e estoura a franquia pelo
> mesmo caminho.
>
> A diferença é que no Evolution isso é **inevitável** (conexão aberta do
> whatsmeow) e na aplicação é **escolha**: restringir o disparo a horário
> comercial derruba de 180 para 97,5 CU-hora.
>
> | Projeto | O que prende acordado | Evitável? | CU-hora | Launch |
> | --- | --- | --- | --- | --- |
> | Evolution | conexões do whatsmeow | não | 180 | US$ 19,08 |
> | Aplicação, como está | cron `* * * * *` | — | 180 | US$ 19,08 |
> | Aplicação, cron 7h–20h | cron em horário comercial | sim | **97,5** | US$ 10,33 |

### A conta do canal de WhatsApp, fechada

| Clínicas pareadas | Contêiner (`lite`) | Neon (Launch) | Total |
| --- | --- | --- | --- |
| 1 | US$ 1,74 | US$ 19,34 | **US$ 21,08** |
| 5 | US$ 10,15 | US$ 19,34 | **US$ 29,49** |
| 10 | US$ 21,02 | US$ 19,34 | **US$ 40,36** |
| 25 | US$ 53,64 | US$ 19,34 | **US$ 72,98** |

O compute do Neon é **custo fixo**, compartilhado por todas as clínicas — o que
faz a conta escalar melhor do que a tabela só dos contêineres sugeria. O que
cresce por clínica é o contêiner.

> **Decisão que é do André:** o canal de WhatsApp exige o plano Launch do Neon.
> Não há caminho free — a suspensão no dia 16 tiraria o WhatsApp (ou o sistema)
> do ar no meio do mês, em silêncio. US$ 19,34/mês é o piso do componente,
> independente do número de clínicas.

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
| A licença atravessa da VPS para o Neon? | `infra/scripts/levar-licenca.sh` — **bloqueado**: o classificador de permissões barra SSH nesta sessão | precisa de permissão ou da mão do André |
| A licença está em `evogo_auth` ou em `evogo_users`? | O diagnóstico do script responde (contagem por tabela). Hoje é **dedução**, de o serviço não ter volume e a ativação sobreviver a recriação | junto com o acima |
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
