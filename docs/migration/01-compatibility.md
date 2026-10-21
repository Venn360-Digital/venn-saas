# 01 — Matriz de compatibilidade e arquitetura de destino

Base: o inventário medido em [`00-inventory.md`](00-inventory.md), `2026-10-21`.

Legenda de veredito:

- **OK** — vai como está, ou com ajuste de configuração.
- **AJUSTE** — vai depois de uma mudança localizada e revisável.
- **REESCRITA** — o componente não tem equivalente; muda de forma.
- **POC** — não se decide sem experimento.

---

## Resumo em uma tabela

| Componente | Hoje | Destino | Veredito |
| --- | --- | --- | --- |
| App Next.js 16 | Node em Docker | Workers via **vinext** | AJUSTE |
| Banco | Supabase PG 17.6 self-hosted | **Neon PG 18, São Paulo** | OK |
| Driver do banco | Prisma 5.22 padrão | **Prisma 6.19.3 + adapter Neon** | AJUSTE |
| Autenticação | Supabase Auth | **Better Auth** (biblioteca) | REESCRITA |
| Cofre de segredos | `supabase_vault` | Cloudflare Secrets + AES-GCM no Neon | REESCRITA |
| Storage público | Supabase Storage | **R2** | AJUSTE |
| Storage sensível | Supabase Storage | provedor BR — **não decidido** | BLOQUEADO |
| Filas | BullMQ + Redis | **Cloudflare Queues** | REESCRITA |
| Cron (14) | BullMQ schedulers | **Cron Triggers** | REESCRITA |
| Tempo real | Supabase Realtime | **Durable Objects + WebSocket** | REESCRITA |
| E-mail | Resend | Cloudflare Email Service | AJUSTE |
| IA | OpenAI direto | OpenAI + Gemini via **AI Gateway** BYOK | AJUSTE |
| RAG / pgvector | pgvector no Supabase | pgvector no Neon | OK |
| Extração PDF/DOCX | `pdf-parse`, `mammoth` | a confirmar em Workers | POC |
| Evolution Go | contêiner na VPS | **Cloudflare Containers** | POC |

---

## 1. Workers + vinext — AJUSTE, com um impedimento de máquina

A Cloudflare recomenda **vinext** (plugin Vite que reimplementa a superfície do
Next.js) em vez do OpenNext para aplicações novas, e o OpenNext passa a ser só
caminho de manutenção. vinext está **em beta** e tem um verificador próprio:
`npx vinext check`. Next.js 16 é alvo suportado, e o projeto está em 16.1.6.
`VERIFICADO` na documentação oficial.

A favor da compatibilidade deste projeto:

- quase nenhuma API de Node (`node:crypto` ×2, `node:path` ×1);
- `serverExternalPackages` já isola LangChain, BullMQ e ioredis;
- nenhum uso de filesystem gravável em `src/`.

### O impedimento

> **macOS 12.7.6 não roda `workerd`**, que exige 13.5+. Tudo o que instancia
> Miniflare falha **ao carregar a configuração**, antes de compilar — e isso
> inclui `@cloudflare/vite-plugin`, que é o motor do vinext.

Consequência prática, e não é pequena: **`vinext dev`, `vinext build` e o deploy
do vinext não rodam nesta máquina.** O `npx vinext check` provavelmente roda (é
análise estática), mas não se deve contar com isso sem testar.

Portanto o pipeline não é uma escolha de estilo:

- **o build e o deploy do app têm de acontecer no CI (Linux)** — GitHub Actions
  ou Workers Builds;
- localmente continua valendo `next dev`, que o `vinext init` não quebra;
- `npm run typecheck` e `lint` continuam locais e são a defesa de perto.

Efeito colateral conhecido: sem Miniflare local, `.cloudflare/types` não é
gerado e `cloudflare:workers` não resolve no typecheck desta máquina. O erro é
esperado e desaparece no CI. **Não resolver com declaração manual de tipo** —
conflita com os tipos gerados lá.

### Primeiro teste a fazer

`npx vinext check` na branch de migração, e ler o painel de compatibilidade do
vinext. Antes disso não há como afirmar que as 107 rotas passam.

---

## 2. Neon PostgreSQL — OK, com três cuidados

Projeto `odontobox` (`polished-shape-42069569`), `aws-sa-east-1`, **PG 18**.
Origem é PG **17.6**: restauração no sentido fácil. `VERIFICADO`

Extensões confirmadas no Neon: `vector 0.8.6`, `pg_trgm`, `pgcrypto`,
`unaccent`, `uuid-ossp`, `pg_stat_statements`, `citext`. `VERIFICADO`

### Cuidado 1 — `supabase_vault` não existe. Ver seção 4.

### Cuidado 2 — a ordem de restauração importa

A migração `20261010100000_accent_insensitive_search` cria
`public.immutable_unaccent(text)` e usa essa função em colunas
`GENERATED ALWAYS AS ... STORED`. Para restaurar:

1. `CREATE EXTENSION unaccent WITH SCHEMA public;`
2. criar `public.immutable_unaccent`;
3. só então as tabelas.

Um `pg_restore` de dump completo já respeita a ordem, mas **rodar as migrations
versionadas do zero é o caminho preferido** — é o que mantém o histórico do
Prisma coerente. Com 19 MB de dados, `migrate deploy` + carga de dados é viável
e mais limpo do que restaurar estrutura.

### Cuidado 3 — pool de conexões

A branch `production` tem `suspend_timeout_seconds: 0` (sem scale-to-zero) e
autoscaling 0,25–2 CU. Para Workers, usar o **endpoint pooled** (PgBouncer do
Neon) na `DATABASE_URL` e o direto só para migrations.

### Prisma: 6.19.3 agora, 7 depois — e por que não 7 já

A última estável do Prisma é **7.10.1**, e ela é a melhor para Workers: sem
engine Rust, bundle menor. Mas o salto de 5.22 para 7 traz quatro mudanças de
uma vez — gerador `prisma-client` com `output` obrigatório, import de caminho
próprio em **47 arquivos**, `prisma.config.ts`, e **ESM only**.

O ESM é o que decide. O processo `workers/` compila em **CJS**
(`format: ['cjs']` no `tsup.config.ts`) e precisa continuar funcionando durante
toda a transição — ele é quem roda as 8 filas e os 14 crons até as Queues e os
Cron Triggers assumirem.

Então: **6.19.3 agora**. Os driver adapters já são GA, `prisma-client-js` e os
imports de `@prisma/client` continuam válidos — os 47 arquivos **não mudam** —, e
o build CJS segue de pé. O Prisma 7 entra depois do corte, quando `workers/`
tiver sido substituído e o conflito de ESM tiver deixado de existir.

### Driver: adapter do Neon, não Hyperdrive

`@prisma/adapter-neon` + `@neondatabase/serverless` fala com o Neon por
HTTP/WebSocket, sem socket TCP e sem Hyperdrive. É o caminho mais curto para
Workers.

`@prisma/adapter-pg` fica instalado em paralelo para o que **não** é Neon:
desenvolvimento local contra Postgres comum e a VPS durante a transição. A
escolha é pelo host da `DATABASE_URL`, não por variável separada — uma coisa a
menos para configurar errado.

**Hyperdrive**: avaliar, não adotar por reflexo. O ganho dele é cache de conexão
e de query, e com o adapter do Neon por HTTP o problema que ele resolve quase
não existe. Medir antes, e só depois que o app rodar em Workers.

### Ação recomendada no Neon

- marcar `production` como **protected** (hoje `protected: false`);
- criar branch **`staging`** a partir dela — custo próximo de zero, é
  copy-on-write;
- elevar `history_retention_seconds` de 6 h para pelo menos 24 h antes do corte,
  para que o *instant restore* cubra um erro percebido no dia seguinte.

---

## 3. Better Auth — REESCRITA, e é o maior item da migração

Decisão já confirmada: biblioteca Better Auth executada pela aplicação, ligada
ao Postgres do Neon. Não Neon Managed Better Auth.

### Dimensão real

- **59 arquivos**, **87 chamadas** `.auth.getUser`;
- fluxos a reimplementar: login por senha, cadastro, recuperação, OTP
  (`verifyOtp`), troca de senha, logout, `onAuthStateChange`,
  `exchangeCodeForSession` (callback OAuth);
- **3 usuários** em `auth.users` — a massa de dados é irrelevante, o volume de
  código é que não é.

### O que *não* muda

`src/lib/auth/workspace.ts` é a autorização de verdade: papéis
`OWNER/ADMIN/GESTOR/ATENDENTE`, cookie `odontobox.workspace` validado contra o
banco, `isActive` conferido. Isso roda sobre Prisma e **sobrevive intacto**.
O Better Auth só substitui "quem é esta pessoa", não "o que ela pode".

Essa separação é o que torna a reescrita viável: o padrão é trocar

```ts
const { data: { user } } = await supabase.auth.getUser()
```

por um `getSession()` do Better Auth e seguir entregando o mesmo `user.id` para
`getWorkspaceMember()`. **Os IDs dos usuários têm de ser preservados** — eles são
chave estrangeira em todo o schema.

### Hashes de senha

Supabase GoTrue usa bcrypt. O Better Auth suporta verificar bcrypt legado e
re-hashear no primeiro login bem-sucedido. Com 3 usuários, a alternativa
segura e mais simples é **forçar redefinição de senha** no corte. Decidido
assim no runbook, salvo objeção.

### Sessões

Sessões ativas **não** são preserváveis entre os dois sistemas. Com 3 usuários,
o custo é um novo login. Documentado como aceito.

---

## 4. O cofre de segredos — REESCRITA, e a migração desbloqueia o que a VPS travava

### O que existe hoje

`src/lib/vault.ts` sobre `supabase_vault` 0.3.1, com 5 segredos, todos de
**plataforma** (globais, não por workspace): `VERIFICADO`

| Nome | Conteúdo |
| --- | --- |
| `platform:asaas:clientId` | chave de API da plataforma Asaas |
| `platform:asaas:clientSecret` | token do webhook do Asaas |
| `platform:instagram_login:clientSecret` | client secret do app Instagram Login |
| `platform:meta_messaging:clientSecret` | client secret do app Meta |
| `platform:meta_messaging:verifyToken` | token do aperto de mão do webhook Meta |

Chamadores: `src/lib/platform-credentials.ts` e `src/lib/meta/webhook.ts`.

### Para onde vão

**Os cinco vão para Cloudflare Secrets**, lidos de `env` e nunca gravados no
banco. É a decisão 14 do MD, e é o destino correto: o motivo de eles estarem no
Vault era que, numa instalação auto-hospedada, o `.env` é arquivo de texto no
mesmo disco do banco, lido por quem tem root. **Em Workers, secret é secret** —
cifrado em repouso, fora do bundle, fora do repositório. O argumento que os
levou ao Vault deixa de existir.

### E o problema maior, que o Vault não cobria

Os tokens **por workspace** estão em texto puro no banco:

| Campo | Conteúdo | Linha |
| --- | --- | --- |
| `Integration.config` | `{ qrCode, sessionId, accessToken, phoneNumber }` | `schema.prisma:682` |
| `AgentWebhook.authConfig` | `{ username, password } \| { token } \| { key, header }` | `schema.prisma:726` |
| `PlatformCredential.credentials` | client ids e secrets | `schema.prisma:1326` |

O comentário de `PlatformCredential` registra o impasse textualmente: cifrar
exigiria *"uma chave que viveria no ambiente que acabamos de esvaziar"*.

**A migração desfaz esse impasse.** Na Cloudflare existe o lugar para a chave
que não existia na VPS. Então:

- `TOKEN_ENCRYPTION_KEY` em Cloudflare Secrets, fora do banco;
- os três campos passam a guardar envelope **AES-256-GCM** (`{v, iv, ct, tag}`),
  cifrado e decifrado pelo **WebCrypto**, que é nativo em Workers — sem
  dependência nova;
- `src/lib/vault.ts` **mantém a interface** (`readVaultSecret`,
  `writeVaultSecret`, `vaultSecretExists`, `platformSecretName`) e troca o motor:
  segredo de plataforma resolve em `env`, segredo por workspace resolve no
  envelope cifrado. `platform-credentials.ts` e `meta/webhook.ts` não mudam de
  forma.

Rotação: versionar o envelope (`v`) permite reescrever com chave nova sem
parada. Documentar o procedimento antes de usar em produção.

> **Transporte dos 5 segredos:** eles saem da VPS para a Cloudflare **pela mão
> do André**, não por esta sessão. O runbook lista os nomes; os valores se leem
> no Studio por túnel SSH e se escrevem com `wrangler secret put`. Nenhum valor
> passa por log, commit ou transcrição.

---

## 5. Storage — AJUSTE no público, BLOQUEADO no sensível

8 pontos de chamada, 5,7 MB de dados. A interface é barata de construir:
`put`, `get`, `delete`, `exists`, `createSignedUrl`, com roteamento **pela
classificação do dado**, não pelo chamador.

### R2 — aprovado só para público/não sensível

R2 foi habilitado na conta em `2026-10-21`; zero buckets. `VERIFICADO`

**A conta é compartilhada entre os SaaS da Venn360**, então os buckets são
separados por produto, classe e ambiente:

```
venn-odontobox360-publico-prod
venn-odontobox360-publico-stg
```

e, para os outros produtos, `venn-<produto>-publico-<ambiente>`. Nunca um bucket
compartilhado entre produtos: o isolamento tem de ser visível na credencial, não
só no prefixo da chave.

Vai para o R2: avatar de agente, prévia de voz, ativo público de marca.

### O que **não** vai para o R2

A localização automática do R2 e os *Location Hints* **não garantem residência
física no Brasil**. Logo, ficam de fora:

- mídia recebida e enviada em conversa — foto, áudio, documento de paciente;
- nota de voz gerada pelo agente (deriva do conteúdo da conversa);
- documento de base de conhecimento, até ser classificado.

E é aí que está quase todo o conteúdo atual do bucket.

### Bloqueio

O provedor com residência no Brasil **não foi escolhido**. Até escolher e
aprovar, **a cópia atual na VPS permanece intacta e é a fonte** desses arquivos.
Comparação em [`00-storage-brasil-options.md`](00-storage-brasil-options.md).

### O que fica no Postgres

Só `storage_provider`, `bucket`, `object_key`, classificação, metadados e
autorização. **Nunca URL assinada persistida** — hoje as services do worker
gravam `getPublicUrl()`, e isso tem de mudar junto com o adaptador.

---

## 6. Filas e cron — REESCRITA

### Filas: BullMQ → Cloudflare Queues

Não há porte possível. BullMQ exige Redis por TCP e um processo que bloqueia em
`BRPOP`; Workers não tem nem um nem outro.

As 8 filas viram consumidores de Queues. O que **se preserva** é a melhor parte
do desenho atual: o contrato já está isolado em
`src/lib/queue/definitions.ts`, separado do processo que consome. Troca-se a
implementação de `enqueue` e o laço do consumidor; os payloads e os
processadores migram quase inteiros.

Pontos a reconstruir à mão, porque o BullMQ os dava de graça:

| Recurso BullMQ | Em Queues |
| --- | --- |
| retentativa com backoff | configuração do consumidor + DLQ |
| deduplicação por job id | chave de idempotência na tabela |
| debounce por conversa (`ai-reply`) | Durable Object por conversa, ou janela no banco |
| trava distribuída (`workers/src/lock.ts`) | Durable Object |

> O `ai-reply` é o caso delicado: hoje é **um job por conversa, com debounce**,
> para não responder três vezes a três mensagens seguidas. Queues entrega
> *at-least-once* e não tem debounce. A implementação natural é um Durable
> Object por conversa, que já será criado para o tempo real — ver seção 7.

### Cron: 14 schedulers → Cron Triggers

Cron Triggers aceitam granularidade de minuto, então `* * * * *` de
`activity-reminders` é expressável. Limite de triggers por Worker é baixo:
a forma econômica é **um punhado de triggers que despacham por tarefa**,
reaproveitando o `cron` que já existe como fila — o escalonamento de horários
atual (`:07`, `:13`, `:17`, `:21`…) continua válido e segue no código.

Fuso: Cron Triggers rodam em **UTC**. Os padrões de hora fixa
(`13 3 * * *`, `0 7 * * *`, `27 5 * * *`, `41 4 * * *`, `47 5 * * *`) estão
escritos em `America/Sao_Paulo` e **têm de ser convertidos**, ou o cron de
briefing das 7 h dispara às 4 h. Item de erro silencioso — está no runbook.

### Workflows

Só para o que é longo e durável: a indexação RAG de um documento grande
(`rag-index`) e a reconciliação de cobrança (`billing-reconcile`) são os
candidatos. Não usar Workflows onde Queues basta.

---

## 7. Tempo real — REESCRITA, Durable Objects

Requisito confirmado: chat, mensagem nova de WhatsApp e status dos agentes
atualizando ao vivo.

Hoje são dois mecanismos sobre Supabase Realtime: assinatura de mudanças da
tabela `conversations` (com polling de 15 s de rede de segurança) e broadcast
`typing:<id>`.

Destino: **um Durable Object por workspace**, com WebSocket e hibernação.

O ponto que precisa estar claro no desenho: **escrita no Postgres não chega sozinha
ao Durable Object.** O Supabase Realtime lia o WAL; o Neon não publica para a
Cloudflare. Então:

1. a transação que grava a mensagem grava também uma linha em **`outbox`**, na
   *mesma* transação;
2. um publicador idempotente lê a `outbox` e põe em Queues;
3. o consumidor entrega ao Durable Object do workspace, que faz fan-out para os
   WebSockets conectados;
4. a linha da `outbox` é marcada como publicada.

Autorização **por conexão**: o handshake do WebSocket valida sessão e
`workspaceId` no servidor. Um Durable Object por workspace é também a fronteira
de isolamento — ninguém recebe evento de outra clínica porque nem está no mesmo
objeto.

O polling de 15 s pode ficar no primeiro corte, como rede de segurança, e sair
depois. Desenho completo em [`06-realtime-design.md`](06-realtime-design.md).

---

## 8. E-mail — AJUSTE

Hoje Resend (`RESEND_API_KEY`, `EMAIL_FROM`). Preferência declarada:
Cloudflare Email Service. Manter adaptador em `src/lib/email` para permitir
troca.

A verificar antes de adotar: limites documentados, domínio remetente e
verificação, SPF/DKIM/DMARC na zona `venn360.com`, tratamento de bounce e teste
de entrega real. **Não há medição desta sessão sobre o produto.** `PENDENTE`

Até confirmar, o Resend fica como implementação ativa — trocar provedor de
e-mail no mesmo corte em que se troca banco, auth, filas e storage é concentrar
risco sem necessidade.

---

## 9. IA — AJUSTE

Hoje OpenAI direto: chat, embeddings 1536-d, TTS (nota de voz) e transcrição.
LangChain para RAG.

Destino: **AI Gateway com BYOK**, OpenAI para chat/atendimento e Gemini para
pesquisa/análise. O Gateway é camada de controle — não troca o modelo, só passa
a URL base por ele. **Não ativar Unified Billing.**

Dois cuidados reais:

- **embeddings**: os vetores já gravados são `text-embedding-*` da OpenAI em
  1536 dimensões. Trocar o modelo de embedding **invalida o índice inteiro** e
  exige reindexar tudo. Manter OpenAI para embeddings, e não misturar.
- **privacidade**: a política é enviar só conteúdo minimizado e anonimizado, e
  bloquear identificador de paciente. Hoje o `ai-reply` monta contexto da
  conversa, que **é** conteúdo de paciente. Isso precisa de um filtro explícito
  antes da chamada, e a rejeição tem de ser registrada **sem registrar o
  conteúdo**. Item de projeto, não de configuração.

Detalhe em [`05-ai-provider-evaluation.md`](05-ai-provider-evaluation.md).

---

## 10. Extração de PDF e DOCX — POC

`src/app/api/agents/knowledge/extract/route.ts` importa `pdf-parse` e `mammoth`
dinamicamente. Ambas são bibliotecas de Node; `pdf-parse` é a de risco maior.

Caminhos, em ordem de preferência:
1. testar as duas em Workers com `nodejs_compat` — pode simplesmente funcionar;
2. se falhar, mover essa rota para o **Container** do Evolution Go ou para um
   Worker separado com mais folga;
3. último recurso, extrair no navegador e enviar só texto.

Não decidir sem testar.

---

## 11. Evolution Go em Containers — POC, e com desconfiança justificada

O MD pede POC e proíbe presumir compatibilidade. O inventário dá uma razão
adicional para desconfiar: **o Evolution Go já não mantém sessão de forma
estável na VPS**, onde o processo nunca hiberna. Dois defeitos medidos e com
vigias no host (`infra/scripts/wa-guard.sh`, `wa-pool-guard.sh`): desliga o
número ~105 s depois de parear, e vaza conexões Postgres até parar de gerar QR
em silêncio.

Levar para um runtime com **scale-to-zero** um componente que já perde sessão
com o processo sempre de pé é o maior risco técnico desta migração.

A POC tem de provar, na ordem:

1. instância sobe e gera QR legível;
2. pareia e **mantém** a sessão (os 105 s são o primeiro corte de prova);
3. recebe e emite webhooks;
4. persiste credenciais fora de disco efêmero;
5. sobrevive a reinício;
6. sobrevive a **período sem tráfego** — é aqui que o scale-to-zero mata;
7. custo estimado pela política real de execução.

Falhando o item 6, a saída é hospedar **só** o Evolution Go em outro serviço
gerenciado de containers, preservando Workers + Neon para todo o resto. Isso é
um resultado aceitável, não um fracasso — e deve ser dito ao André como opção
desde já, porque muda o custo.

Sessão de WhatsApp é **uma por workspace** — isso é requisito de produto, já
confirmado. O que a POC decide é se um runtime pode gerenciar várias com
isolamento provado, ou se cada uma precisa de container próprio. Nunca misturar
credenciais de clientes.

---

## 12. Ordem de execução que o acoplamento impõe

A reescrita de auth, filas e storage não é paralela: todas tocam as mesmas
rotas. A ordem que minimiza retrabalho:

1. **Neon + Prisma 6** — sem isso nada mais roda; é também o passo reversível.
2. **Cofre** (Cloudflare Secrets + AES-GCM) — destrava integrações.
3. **Adaptador de storage** com classificação; só a classe pública migra.
4. **Better Auth** — o item grande; 59 arquivos.
5. **Queues + Cron Triggers**, com o Durable Object de trava/debounce.
6. **Durable Objects do tempo real.**
7. **vinext**, build no CI, preview.
8. **POC do Evolution Go**, em paralelo desde o início — o resultado dela pode
   mudar o desenho, então começar cedo.

O storage sensível e o corte de DNS ficam fora dessa lista: dependem de
aprovação, não de código.

---

## 13. RLS: o controle sai junto com a exposição que ele compensava

Descoberto **tentando**, não lendo: `prisma migrate deploy` contra o Neon falhou
na migração `20261006000000_enable_rls` com `schema "auth" does not exist`.

### O que aquela migração era

O comentário dela explica o desenho inteiro, e vale citar a estrutura: RLS
habilitado nas **27** tabelas, política de `SELECT` em apenas duas
(`conversations` e `messages`), e `REPLICA IDENTITY FULL` nessas duas.

A razão declarada: o PostgREST do Supabase expõe o schema `public` ao papel
`anon`, e **a chave anon viaja dentro do bundle do navegador**. Sem RLS,
`GET /rest/v1/contacts` com aquela chave devolveria a tabela de contatos inteira
a qualquer pessoa que abrisse o app. As duas políticas existiam porque o
`postgres_changes` do Realtime avalia RLS **como o assinante**, e sem política
permissiva ele entrega silêncio — uma tela que nunca atualiza e não registra
erro.

### Por que nada disso sobrevive, e por que isso não é perda

Cada premissa desaparece com o Supabase:

| Premissa | No Neon + Cloudflare |
| --- | --- |
| `auth.uid()` | não existe; com Better Auth a sessão é resolvida **pela aplicação** e nunca chega ao banco |
| PostgREST expondo `public` ao `anon` | não há. A Data API do Neon é opt-in e não está provisionada |
| chave anon no navegador | não há |
| `postgres_changes` avaliando RLS como assinante | o tempo real passa a ser Durable Object, autorizado **no handshake, pelo servidor** |
| `REPLICA IDENTITY FULL` | puro WAL extra: `messages` é atualizada a cada recibo de entrega, e ninguém decodifica esse WAL |

> Retirar o RLS aqui **não é** abrir mão de defesa em profundidade por
> conveniência. É retirar um controle compensatório junto com a exposição que ele
> compensava. A porta que ele trancava deixa de existir no mesmo movimento.

Portar seria pior do que remover: exigiria inventar um mecanismo novo — variável
de sessão por pedido, algo como `SET LOCAL app.workspace_id` — para substituir
`auth.uid()`. Isso é maquinaria de segurança nova e não testada, cuja única
função seria guardar uma porta que não existe mais, e cujo modo de falha é
silencioso: um `SET` esquecido devolve vazio em vez de erro.

### O que foi feito

A migração foi tornada **portável** em vez de removida:

- `ENABLE ROW LEVEL SECURITY` nas 27 tabelas **continua rodando em todo lugar**.
  No Neon a aplicação conecta como dona das tabelas, que ignora RLS, então é
  inofensivo — e mantém negar-por-omissão para qualquer papel futuro que não seja
  o dono. Barato, e falha na direção certa.
- a função de associação, as duas políticas, a publicação e o `REPLICA IDENTITY`
  ficam condicionados à existência do schema `auth`. No Supabase o comportamento
  é idêntico ao de antes; no Neon viram no-op.

Medido na branch de homologação do Neon por `npm run check:neon`: **27 tabelas
com RLS, 0 políticas, `current_workspace_ids` ausente.** A migração condicional
caiu no ramo certo — e é por isso que o teste confere o que **não** deve existir,
não só o que deve.

### Onde a defesa de inquilino fica agora

Em `src/lib/auth/workspace.ts`, validando `workspaceId` no servidor a cada
pedido, com `isActive` conferido e papel aplicado — que é onde ela sempre esteve
de fato. O `lint:workspace` do projeto já impede que uma rota resolva workspace
por conta própria, e ele continua passando.

**Consequência a aceitar explicitamente:** a segunda linha de defesa que o RLS
dava contra um defeito de aplicação sai. O comentário original afirmava que ele,
sozinho, teria bloqueado os seis defeitos de vazamento entre inquilinos que a
auditoria encontrou. Com uma via de acesso só — a aplicação —, o preço de um
defeito de autorização sobe. Isso torna os **testes multi-tenant da Fase 5
obrigatórios**, não desejáveis.

### Nota sobre o checksum

Editar uma migração já aplicada muda o checksum que o `_prisma_migrations` da
VPS guarda. Isso é aceitável porque a VPS passa a ser **origem somente leitura**
e nenhum `migrate deploy` roda mais contra ela. No Neon o checksum novo foi
registrado de forma consistente desde o início.
