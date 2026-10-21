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

### 2. Provedor de storage clínico — **BLOQUEIA mover arquivo sensível** 🔴

Comparação feita em [`00-storage-brasil-options.md`](00-storage-brasil-options.md).
Recomendação: **Magalu Cloud `br-se1` (São Paulo)** — R$ 0,10/GiB armazenado,
R$ 0,10/GiB de saída, **requisição grátis**, cobrança em real, empresa e
datacenter brasileiros.

**Precisa de:** aval para criar a conta e o bucket (custo contínuo).

Enquanto não houver, a cópia na VPS permanece a fonte e **nada de clínico se
move**. O corte pode acontecer antes disso — ver runbook.

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

### 6. Divergência de variável a resolver ⚠️

`.env.example` documenta `WEBHOOK_BASE_URL`; `.env` e `.env.local` reais usam
`WEBHOOK_URL`. Um dos dois está errado, e isso precisa estar resolvido **antes**
de montar os secrets de produção na Cloudflare — senão o webhook aponta para
lugar nenhum e o sintoma aparece só quando chegar a primeira mensagem.

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
| Storage clínico no Brasil | **aguardando aval** | Magalu `br-se1` |
| Topologia do Evolution Go | **aguardando POC** | decidir só com o experimento; §3 da Parte 1 |
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

O que **não** se deve fazer é trocar de biblioteca ou de provedor de QR: o
primeiro não muda nada e o segundo entrega a sessão a terceiro.
