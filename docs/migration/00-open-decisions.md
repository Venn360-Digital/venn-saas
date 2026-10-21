# 00 — Decisões e bloqueios

Atualizado em **2026-10-21**.

---

## Parte 1 — Bloqueios: o que depende do André

Em ordem de urgência. Os marcados **BLOQUEIA** impedem uma etapa concreta.

### 1. macOS 12.7.6 não roda `workerd` — **BLOQUEIA o build local** 🔴

`workerd` exige macOS 13.5+. Tudo que instancia Miniflare falha **ao carregar a
configuração**, antes de compilar — e isso inclui `@cloudflare/vite-plugin`, que
é o motor do vinext. Logo: **`vinext dev`, `vinext build` e o deploy do vinext
não rodam nesta máquina.**

Não é contornável por configuração. As saídas, e só há três:

| Saída | Custo | Avaliação |
| --- | --- | --- |
| **Build e deploy no CI (Linux)** | zero | **é o caminho** — ver §2.6 |
| Atualizar o macOS para 13.5+ | tempo, risco em máquina de trabalho | melhora o laço de desenvolvimento |
| Máquina/VM Linux para builds | custo e manutenção | desnecessário com CI |

**Decisão tomada:** build e deploy no CI. Local fica `next dev`, `typecheck` e
`lint`, que é onde 95 % dos erros aparecem mesmo. **Não bloqueia o trabalho
atual**, mas bloqueia o primeiro deploy — e o André precisa saber que o ciclo
"testar em Workers" vai passar por *push*, não por terminal.

### 2. Provedor de storage clínico — **DECIDIDO: R2** ✅

**Decisão do André em 2026-10-21: tudo no Cloudflare R2**, separado em dois
buckets — `odontobox-public` e `odontobox-private`, ambos criados. A Magalu
Cloud `br-se1` foi avaliada e **recusada**.

O que ficou registrado junto com a decisão, porque muda o que se pode afirmar:
**o arquivo clínico não fica no Brasil.** O R2 não tem região na América do Sul
e não existe jurisdição `br`; os buckets nasceram em `ENAM`. O André registrou
que declara a residência no contrato de privacidade — a divergência com a
documentação do fornecedor foi apontada e a decisão foi reafirmada. Ver o
cabeçalho de [`00-storage-brasil-options.md`](00-storage-brasil-options.md).

**Feito:** buckets criados; `provedorDa(CLINICO)` passou a devolver
`r2-privado`; `PRIVATE_STORAGE_*` documentado; `check:storage` com 20 provas
passando.

**O que substitui este bloqueio, e é menor:**

1. **Cifra na aplicação** antes do `put`, com a chave fora do bucket. É o que
   sustenta a decisão agora que a localização não sustenta. Não implementada.
2. **`Message.mediaUrl` guarda URL.** Para clínico a URL é assinada e vence em
   10 minutos, então persistir uma faz a imagem dar 404 depois. **Isto impede
   ligar o arquivamento clínico no caminho real** mesmo com o provedor decidido.
3. **Token de API do R2** — as 2 provas de ciclo completo seguem em `SKIP`.

### 3. Evolution Go em Containers — **BLOQUEIA desligar a VPS** 🔴

O Evolution Go **já não mantém sessão de forma estável na VPS**, onde o processo
nunca hiberna: dois defeitos medidos, com vigias no host
(`infra/scripts/wa-guard.sh`, `wa-pool-guard.sh`) — desliga o número ~105 s
depois de parear, e vaza conexões Postgres até parar de gerar QR em silêncio.

Levar para runtime com **scale-to-zero** um componente que perde sessão com o
processo sempre de pé é o maior risco técnico desta migração.

**O que o André precisa decidir desde já, porque muda o custo:** se a POC falhar
no item "sobrevive a período sem tráfego", a saída é hospedar **só** o Evolution
Go num serviço gerenciado de containers (Fly.io, Railway, ou uma VPS mínima),
mantendo Workers + Neon para todo o resto. Isso é um resultado aceitável, não um
fracasso — mas significa que **a VPS não desaparece inteira**, ou é substituída
por algo menor.

### 4. Recursos da Cloudflare ainda não provisionados ⚠️

| Recurso | Estado | Necessário para |
| --- | --- | --- |
| R2 | ✅ **habilitado em 2026-10-21** | storage público |
| Queues | não provisionado | as 8 filas |
| Durable Objects | não provisionado | tempo real, trava, debounce |
| AI Gateway | não provisionado | OpenAI + Gemini BYOK |
| Containers | não provisionado | POC do Evolution Go |
| Email Service | não verificado | e-mail transacional |
| Hyperdrive | não provisionado | avaliar depois, não antes |

Todos dependem do **Workers Paid**, que consta como contratado mas **não foi
possível confirmar pela API** — o MCP de Code Mode está falhando.

### 5. Ferramentas e acessos ⚠️

| Item | Estado | Impacto |
| --- | --- | --- |
| **Wrangler** | não instalado, nem no projeto nem global | necessário para secrets e deploy; instalar como `devDependency` quando a Fase 4 chegar nele |
| **MCP Cloudflare (Code Mode)** | **falhando** — `whoami` e `execute` dão erro do conector em toda tentativa | não consigo ler zona, DNS nem confirmar o plano. Contorno parcial: o MCP antigo por recurso funciona para Workers e R2 |
| **MCP GitHub** | **não conecta** — `400 Authorization header is badly formatted` | contornado: `gh` CLI autenticado como `venn360` |
| **MCP Supabase / Vercel / Prisma** | não autorizados, OAuth pendente | sessão não interativa não consegue autorizar. Autorizar em sessão interativa se forem necessários |

> A memória do projeto registrava que **leitura** pela Cloudflare funcionava. Em
> 2026-10-21 não funciona mais nem para leitura. Vale conferir a autorização do
> conector.

### 6. Variáveis de webhook — ~~divergência~~ **duas faltas espelhadas** ✅

**Resolvido em 2026-10-21.** O diagnóstico anterior estava errado: registrava
"um dos dois está errado", e seguir aquilo apagaria uma variável legítima. Não
há divergência — são **duas variáveis com consumidores distintos**:

| Variável | Quem lê | Forma |
| --- | --- | --- |
| `WEBHOOK_BASE_URL` | o app, em `src/lib/whatsapp/index.ts` (`webhookUrlFor`) | **base sem caminho**; o app anexa `/api/webhooks/<provedor>` |
| `WEBHOOK_URL` | o Compose, como `WEBHOOK_GLOBAL_URL` do Evolution v2 (`infra/compose.yaml:209`) | **URL completa, com caminho** |

Cada arquivo tinha exatamente uma das duas — defeitos espelhados:

- `.env` e `.env.local` tinham só `WEBHOOK_URL`. O app caía no fallback
  `NEXT_PUBLIC_APP_URL` e montava `http://localhost:3000/api/webhooks/...` —
  endereço que o contêiner do provedor **não alcança**. Defeito vivo, e com o
  sintoma adiado até a primeira mensagem. Corrigido com a base do túnel que já
  estava nos arquivos.
- `.env.example` tinha só `WEBHOOK_BASE_URL`. Instalação nova dava
  `WEBHOOK_GLOBAL_URL` **vazio** ao Evolution v2 — a mesma classe de bug que o
  comentário de `DISABLED_FEATURES` em `infra/scripts/setup-env.mjs` descreve.
  Corrigido documentando as duas, com quem lê cada uma.

`infra/scripts/setup-env.mjs` já escrevia as duas, corretamente — era a única
fonte coerente.

**Consequência para o corte, que segue aberta:** os valores da VPS não
sobrevivem à Cloudflare. `http://app:3000` existe por causa da rede do Compose;
no Worker não há `app:3000`, então `WEBHOOK_BASE_URL` passa a ser a origem
pública do Worker. E `WEBHOOK_URL` só continua existindo enquanto o Evolution v2
existir — se o canal oficial falar direto com o Graph API, como recomendado na
seção de custo de CU, essa variável sai junto com o contêiner.

---

## Parte 2 — Decisões que eu tomei

Rotina, dentro da arquitetura já aprovada. Registradas para serem contestadas se
alguma estiver errada.

| # | Decisão | Por quê |
| --- | --- | --- |
| 1 | **Segredos de plataforma → Cloudflare Secrets**, e os graváveis → AES-256-GCM na tabela `app_secrets` | Confirmado pelo André em 2026-10-21. Já implementado no commit `8d941e3` |
| 2 | Gravação de segredo de ambiente é **recusada com erro**, não ignorada | Ignorar faria a tela dizer "salvo" sem salvar, e alguém iria embora achando que rotacionou uma credencial |
| 3 | **Migrations do zero no Neon**, não `pg_restore` da estrutura | 19 MB de dados; rodar as 44 migrations mantém o histórico do Prisma coerente, e restaurar estrutura o deixaria divergente |
| 4 | **Forçar redefinição de senha** no corte, em vez de migrar hash bcrypt | São **3 usuários**. Carregar compatibilidade de hash legado para 3 pessoas é complexidade sem retorno |
| 5 | **Sessões ativas não são preservadas** | Não há caminho entre os dois sistemas; com 3 usuários o custo é um login |
| 6 | **E-mail continua no Resend no primeiro corte** | Trocar provedor de e-mail no mesmo corte em que trocam banco, auth, filas e storage é concentrar risco sem necessidade. Cloudflare Email Service entra depois, pelo adaptador |
| 7 | **Embeddings continuam na OpenAI** | Os vetores gravados são 1536-d da OpenAI; trocar o modelo invalida o índice inteiro |
| 8 | **Hyperdrive só depois de medir** | O ganho é cache de conexão; sem o app rodando em Workers não há o que medir |
| 9 | **Polling de 15 s fica no primeiro corte** do tempo real | É rede de segurança já existente; sai quando os Durable Objects estiverem provados |
| 10 | Buckets nomeados `venn-<produto>-<classe>-<ambiente>` | A conta R2 é compartilhada entre os SaaS; isolamento tem de estar na credencial, não no prefixo da chave |
| 11 | **Um repositório por SaaS** (não monorepo) | Ver §3 |
| 12 | `main` = produção, PR obrigatório, deploy de produção com **aprovação humana** | Ver [`08-github-versioning-ci-cd.md`](08-github-versioning-ci-cd.md) |
| 13 | **Só o OdontoBox360 neste ciclo** | É o piloto; os outros replicam depois dos critérios de sucesso |
| 14 | **Evolution em projeto Neon próprio, com uma base única** | Confirmado pelo André em 2026-10-21. Duas razões que apontam para o mesmo lado: a franquia do Neon é **por projeto**, então separar impede que o canal de WhatsApp suspenda o sistema inteiro; e preserva o isolamento de segurança que `compose.staycloud.yaml` já tinha (credencial de aparelho do whatsmeow não divide servidor com dado clínico). Custa de US$ 10 a 19/mês a mais que consolidar. Dentro do projeto, o mínimo: **1 base** no lugar de 3 |

### §3 — Repositórios: um por SaaS

**Recomendação: manter um repositório por produto.** Não mover nada agora.

O que o inventário mostra: o OdontoBox360 tem 407 arquivos e 107 rotas, e o
compartilhamento real com os outros SaaS hoje é **zero** — os dois outros
Workers na conta (`janainaleiteadv`, `advogadamohs`) são sites Astro, não
aplicações com a mesma espinha.

Monorepo resolve duplicação que já existe. Aqui ela não existe ainda, e criar
monorepo antes do segundo inquilino é pagar a complexidade adiantado para um
benefício hipotético. O caminho é extrair pacote quando o **segundo** produto
precisar da mesma peça — e os candidatos já são visíveis: o cofre
(`lib/secrets`), o adaptador de storage, a camada de integrações.

Nada de reorganizar repositório sem aprovação.

---

## Parte 3 — Decisões do MD que seguem em aberto

| Tema | Estado | Recomendação |
| --- | --- | --- |
| Storage clínico | **decidido 2026-10-21** | **R2, bucket `odontobox-private`.** Magalu recusada; o arquivo não fica no Brasil e isso está registrado |
| Topologia do Evolution Go | **decidido 2026-10-21** | **projeto Neon separado, uma base só dentro dele.** A franquia do Neon é por projeto, então separar contém o raio de alcance: estourar derruba o WhatsApp, não o sistema. Provisionado como `odontobox-evolution`. Ver [`11`](11-poc-evolution-go.md) §1.3 |
| Residência para os outros nichos (jurídico, intercâmbio) | em aberto | aplicar a mesma classificação; até decidir, R2 só recebe o claramente público |
| Escopo do rollout | em aberto | só OdontoBox360 agora |
| CI/CD e proteção de branch | em aberto | `main` protegida, PR + checks, produção com aprovação |
| Integrações por produto | em aberto | não habilitar escopo OAuth onde o produto não usa |
| Meta Ads / Google Ads / Analytics | **não existem no código** | só adaptador documentado; não registrar app nem pedir permissão |

---

## O custo de CU é de duas coisas, e só uma é do Evolution

Registrado em 2026-10-21, a partir da pergunta do André: "o problema de CU está
relacionado a conexão com o banco 24/7. Isso é causado pelo Evolution API?"

Separar as duas é o que abre as alternativas:

| O que fica 24/7 | Por quê | É do Evolution? |
| --- | --- | --- |
| O **socket com o WhatsApp** | o canal QR é um aparelho vinculado, e aparelho vinculado tem de ficar conectado para receber | **não** — é do protocolo multi-device |
| A **conexão com o Postgres** | o Evolution Go **vaza conexões**: 100 de 100 ociosas, acumuladas desde o dia anterior (medido 2026-10-14, `infra/scripts/wa-pool-guard.sh`) | **sim** — é defeito dele |

Ou seja: parte dos ~US$ 19/mês de compute é pagar por um bug de terceiro. Um
cliente que fechasse conexão ociosa deixaria o compute do Neon suspender entre
as mensagens — e clínica não tem tráfego de WhatsApp das 21h às 7h.

### As alternativas, da mais estrutural para a mais tática

**1. Canal oficial da Meta (Cloud API) — elimina o problema, não o reduz.**

Na Cloud API não há socket persistente: a Meta hospeda a conexão, a mensagem
chega como **webhook** e o envio é uma chamada HTTPS. Não há processo sempre
ligado. Isso dispensa de uma vez: o contêiner, o projeto Neon do Evolution, o
pareamento por QR, o defeito dos 105 s, o vazamento de conexões, os dois vigias
de shell e a licença.

Dois poréns: depende da revisão da Meta (já submetida — ver
[[canal-oficial-meta]]), e a Meta cobra por conversa, então o custo muda de
forma, não desaparece.

E um detalhe que vale dinheiro: **hoje o canal oficial passa pelo Evolution v2,
que é contêiner — e não precisa.** A Cloud API é webhook e HTTPS; o
`ChannelProvider` de `src/lib/whatsapp/` já é interface, então um cliente que
fale direto com o Graph API da Meta entra como implementação nova atrás da
mesma costura. Isso remove o contêiner e o banco `evolution_v2` do canal
oficial.

**2. Pooler dentro do contêiner — tático, e não depende da Meta.**

Um `pgbouncer` ao lado do Evolution Go, com `server_idle_timeout` curto, absorve
as conexões vazadas e fecha as de cima quando não há consulta. Aí o compute do
Neon suspende de madrugada: de 180 para ~97,5 CU-hora, que **cabe na franquia
free** ou custa US$ 10,33 no Launch.

Custo: um processo a mais num contêiner de 256 MiB, e uma incógnita — não está
provado que o Evolution Go funciona atrás de pooler (é a mesma pergunta aberta
do pooler do Neon). Testável na POC.

**3. Trocar a biblioteca do canal QR — não resolve.**

whatsmeow, Baileys, qualquer uma: o socket persistente é do protocolo. E o
Baileys já foi descartado neste projeto.

**4. Provedor hospedado de QR (Z-API e afins) — move o custo e piora a posse.**

Eles mantêm o socket e nos entregam webhook, o que elimina o nosso custo
sempre-ligado e adiciona o deles. Mas põe um terceiro na posse da sessão de
WhatsApp da clínica. Para dado clínico é troca pior.

### Recomendação

O caminho estrutural é o **1** — e ele já está em andamento, esperando a Meta. O
caminho tático é o **2**, que vale enquanto o QR existir e é barato de testar.

> **Atualização de 2026-10-21, com a topologia decidida.** Com os dois projetos
> separados, o problema de CU se parte em dois pedaços independentes, e cada um
> tem a sua saída:
>
> | Projeto | O que prende acordado | Saída | Resultado |
> | --- | --- | --- | --- |
> | `odontobox-evolution` | conexão do whatsmeow (inevitável enquanto houver QR) | pooler no contêiner (caminho 2), ou Cloud API (caminho 1) | hoje **exige Launch**, US$ 19,34 |
> | `odontobox` (app) | o cron `* * * * *` (**escolha**) | restringir a `* 10-23 * * *` | 97,5 CU-h — **cabe na franquia free** |
>
> O que mudou de importante: a restrição do cron voltou a valer. Consolidado ela
> não economizaria nada, porque a conexão do Evolution manteria o compute
> compartilhado acordado de todo jeito.

O que **não** se deve fazer é trocar de biblioteca ou de provedor de QR: o
primeiro não muda nada e o segundo entrega a sessão a terceiro.
