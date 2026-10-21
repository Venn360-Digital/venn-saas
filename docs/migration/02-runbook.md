# 02 — Runbook da migração

**Janela aprovada de indisponibilidade: 2 horas.**

Com **19 MB de banco**, **5,7 MB de arquivos** e **3 usuários** — medidos em
2026-10-21 —, a cópia de dados leva minutos. A janela não é o gargalo. O
gargalo é a reescrita (auth, filas, storage, tempo real), que acontece **antes**
do corte e não consome janela nenhuma.

Nada neste runbook se executa sem o gate de [`03-go-no-go.md`](03-go-no-go.md).

---

## Convenções

- `[LOCAL]` roda na máquina do André · `[VPS]` na VPS · `[CI]` no GitHub Actions
- `⚠️` exige aprovação explícita antes de rodar
- Toda variável entre `<>` se preenche na hora. **Nenhuma senha na linha de
  comando** — use `PGPASSWORD` via prompt ou `~/.pgpass`, nunca o histórico do
  shell.

---

## Fase A — Preparação (sem indisponibilidade, reversível)

### A.1 Branch e Neon de homologação

1. `[LOCAL]` branch `migracao/cloudflare-neon` — **feito**.
2. ⚠️ `[LOCAL]` no Neon: marcar `production` como **protected** (hoje
   `protected: false`).
3. ⚠️ `[LOCAL]` criar branch Neon **`staging`** a partir de `production`.
   Copy-on-write: custo próximo de zero com o projeto vazio.
4. ⚠️ `[LOCAL]` elevar `history_retention_seconds` de **6 h** para **≥ 24 h**.
   Com 6 h, um erro percebido na manhã seguinte já está fora do alcance do
   *instant restore*.

**Validação:** `list_branches` mostra duas branches e `production` protegida.

### A.2 Estrutura no Neon de homologação

```bash
# [LOCAL] a URL vem do Neon, branch staging, endpoint DIRETO (não pooled):
# migration precisa de conexão direta.
export DATABASE_URL='<neon-staging-direct>'
npx prisma migrate deploy
```

**Pré-condição:** `unaccent` tem de existir em `public` antes das tabelas. A
migração `20261010100000_accent_insensitive_search` já faz
`CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public` e cria
`public.immutable_unaccent` antes de usar — logo, `migrate deploy` na ordem
resolve sozinho.

**Validação:**
- 46 tabelas em `public` (igual à VPS);
- `select extname from pg_extension` inclui `unaccent` e `vector`;
- as colunas `searchText` existem e são geradas — testar
  `insert` de "André" e `select` filtrando por `andre`.

### A.3 Backup da produção — e **não** no disco da VPS

> **O disco da VPS está a 87 % (5,0 G livres).** O dump de 19 MB caberia, mas
> escrever backup num disco quase cheio é o tipo de economia que custa caro.
> O dump vem **direto para a máquina local**, por stdout sobre SSH.

```bash
# [LOCAL] estrutura + dados, sem tocar no disco remoto
ssh root@<vps> "docker exec supabase-db pg_dump -U postgres -Fc --no-owner --no-acl postgres" \
  > ~/backups/odontobox-$(date +%Y%m%d-%H%M).dump

# [LOCAL] e os papéis/auth, em texto, para consulta
ssh root@<vps> "docker exec supabase-db pg_dump -U postgres --schema=auth --data-only postgres" \
  > ~/backups/odontobox-auth-$(date +%Y%m%d-%H%M).sql
```

**Validação obrigatória — backup não conferido não é backup:**

1. `ls -la` mostra tamanho plausível (dezenas de MB, não 0 e não 20 bytes);
2. `pg_restore --list <arquivo>` lista os objetos sem erro;
3. restaurar num **banco isolado** (branch Neon descartável ou Postgres local) e
   comparar `count(*)` das tabelas maiores contra a origem.

Só depois dos três o backup conta como válido.

### A.4 Arquivos: copiar preservando o original

```bash
# [LOCAL] inventário com checksum, antes de copiar
ssh root@<vps> "find /var/lib/docker/volumes/compose_supabase_storage_data/_data -type f -exec sha256sum {} +" \
  > ~/backups/storage-sha256-$(date +%Y%m%d).txt
wc -l ~/backups/storage-sha256-*.txt   # quantos objetos
```

Depois, **classificar** cada arquivo (ver `01-compatibility.md` §5):

- **público/não sensível** → R2, bucket `venn-odontobox360-publico-prod`;
- **clínico sensível** → ⚠️ **bloqueado** até a aprovação do provedor brasileiro.
  Permanece na VPS, que segue sendo a fonte.

**O original na VPS não se apaga em nenhuma hipótese nesta fase.**

**Validação:** contagem, soma de tamanhos e os sha256 conferem entre origem e
destino, objeto por objeto.

### A.5 Secrets

```bash
# [LOCAL] gerar a chave do cofre (32 bytes, base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

⚠️ Publicar no Worker, um por vez. **Os valores os lê o André**, no Studio por
túnel SSH; nenhum passa por log, commit ou transcrição de sessão:

```bash
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put PLATFORM_ASAAS_CLIENT_ID
npx wrangler secret put PLATFORM_ASAAS_CLIENT_SECRET
npx wrangler secret put PLATFORM_INSTAGRAM_LOGIN_CLIENT_SECRET
npx wrangler secret put PLATFORM_META_MESSAGING_CLIENT_SECRET
npx wrangler secret put PLATFORM_META_MESSAGING_VERIFY_TOKEN
npx wrangler secret put DATABASE_URL
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put EVOLUTION_GO_API_KEY
npx wrangler secret put EVOLUTION_API_KEY
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
```

Onde ler os cinco de plataforma, por túnel SSH no Studio ou por `psql`:

```sql
-- os NOMES, para conferir a lista (não os valores)
select name, description from vault.secrets order by name;
-- e o valor, um por vez, só na hora de colar no wrangler
select decrypted_secret from vault.decrypted_secrets where name = '<nome>';
```

**Validação:** `wrangler secret list` mostra os 12 nomes. Nenhum valor aparece
em nenhum log.

### A.6 CI: build e deploy no Linux

Obrigatório, não preferência: **`workerd` não roda no macOS 12.7.6** desta
máquina (ver [`00-open-decisions.md`](00-open-decisions.md) §1).

`.github/workflows/`:

| Workflow | Dispara | Faz |
| --- | --- | --- |
| `checks.yml` | PR | `npm ci`, `prisma generate`, `typecheck`, `lint`, `check:cofre`, `check:widget`, `lint-colors`, `lint-workspace` |
| `preview.yml` | PR | build vinext + deploy de preview |
| `deploy.yml` | push em `main` | build + deploy em produção, **com environment protegido exigindo aprovação** |

**Build de PR não pode alcançar secret de produção.** Usar GitHub Environments:
`preview` com os secrets de homologação, `production` com revisor obrigatório.

**Validação:** abrir um PR de rascunho e confirmar que os checks rodam e que o
preview sobe. É aqui que se descobre se o vinext compila — e é a primeira vez
que se pode descobrir isso.

### A.7 POC do Evolution Go — começar **cedo**, em paralelo

⚠️ Exige Containers (custo). O resultado pode mudar o desenho, então não espera
a Fase A terminar. Os 7 critérios estão em `01-compatibility.md` §11; o decisivo
é o **6 — sobrevive a período sem tráfego**.

Falhando o 6: hospedar só o Evolution Go fora da Cloudflare. Decisão do André,
porque muda o custo e significa que a VPS não desaparece inteira.

---

## Fase B — Homologação de ponta a ponta (sem indisponibilidade)

Rodar a bateria de [`05`](05-ai-provider-evaluation.md) e da Fase 5 do MD contra
**staging**, com dado sintético. Nunca dado real de paciente fora de ambiente
autorizado.

Mínimo para passar adiante:

- [ ] login, cadastro, recuperação, troca de senha, logout — **`npm run check:auth` cobre os cinco**; o que falta é na tela
- [ ] callback OAuth do Google Calendar
- [ ] **multi-tenant**: usuário do workspace A não lê, altera, apaga nem gera URL
      assinada para arquivo do workspace B
- [ ] papéis: `ATENDENTE` recusado onde `EDITOR_ROLES` é exigido
- [ ] upload, download, delete; arquivo privado; URL assinada de validade curta;
      objeto ausente responde 404 e não 500
- [ ] webhook do Asaas: assinatura válida, **evento repetido não cobra duas
      vezes**
- [ ] webhook da Meta: aperto de mão com o `verifyToken` vindo do secret
- [ ] WhatsApp: recebe, grava, responde
- [ ] tempo real: mensagem nova aparece sem recarregar; reconexão funciona
- [ ] os 13 crons disparam **no horário certo** — ver C.0
- [ ] IA: chamada com identificador de paciente é **bloqueada**, e a recusa é
      registrada sem registrar o conteúdo

### C.0 — A armadilha do fuso nos crons

**Cron Triggers rodam em UTC.** Os padrões atuais estão escritos em
`America/Sao_Paulo` (`tz` explícito no BullMQ). Sem conversão, o briefing das
7 h dispara às 4 h, e o de retenção das 4 h41 dispara às 1 h41.

A converter (BRT = UTC−3):

| Tarefa | Hoje (BRT) | Em UTC |
| --- | --- | --- |
| `credits-reset` | `13 3 * * *` | `13 6 * * *` |
| `retention` | `41 4 * * *` | `41 7 * * *` |
| `billing-dunning` | `27 5 * * *` | `27 8 * * *` |
| `billing-reconcile` | `47 5 * * *` | `47 8 * * *` |
| `follow-up` | `0 7 * * *` | `0 10 * * *` |

Os de hora em hora (`7 * * * *`, `17 * * * *`…) e o de cada minuto não precisam
de conversão. **Atenção ao horário de verão: o Brasil não o adota hoje, mas se
voltar, estes cinco saem de hora.** Registrar isso no código, não só aqui.

---

## Fase C — Corte ⚠️ (dentro da janela)

Ensaio cronometrado obrigatório **antes**. Se o ensaio passar de 2 h, não
executar.

| # | Passo | Tempo | Reversão |
| --- | --- | --- | --- |
| 1 | Avisar os 3 usuários | — | — |
| 2 | Baixar TTL do DNS de `odontobox.venn360.com` para 60 s — **≥ 1 h antes** | 1 min | voltar o TTL |
| 3 | Pôr a VPS em manutenção: `docker compose stop app worker` (**não** `down -v`) | 1 min | `start` |
| 4 | Dump final (A.3) | ~2 min | — |
| 5 | Restaurar dados no Neon `production` | ~5 min | truncar e repetir |
| 6 | Conferir `count(*)` tabela por tabela contra a origem | ~5 min | — |
| 7 | Copiar os arquivos **públicos** para o R2 | ~2 min | — |
| 8 | Publicar o Worker a partir do commit aprovado | ~5 min | republicar o anterior |
| 9 | `npm run migrar:usuarios --aplicar` — gera um link de definição de senha por usuário | ~2 min | nenhuma credencial foi tocada; repetir gera links novos |
| 9b | Fumaça em produção: login com um dos links, abrir conversa, enviar mensagem | ~10 min | — |
| 10 | Apontar o DNS para o Worker | 1 min | **voltar o registro** |
| 11 | Reapontar os webhooks (Meta, Asaas, Evolution) para o domínio novo | ~10 min | voltar as URLs |
| 12 | Observar 30 min | 30 min | — |

**Soma: ~1 h 17 min**, com folga dentro das 2 h.

> **Sobre os usuários.** Os hashes do GoTrue são bcrypt e o Better Auth usa
> scrypt: hash não se desconverte, e carregar verificação de bcrypt legado para
> **três** pessoas seria complexidade permanente por um ganho de um dia. O passo
> 9 gera um link de uma hora, de uso único, por pessoa — nenhuma senha trafega,
> e quem escolhe é a própria pessoa. Provado ponta a ponta: usuário sem
> credencial → link → senha definida → login funcionando.

> **Passo 5, nunca:** `pg_restore --clean`, `DROP`, `TRUNCATE` em base cuja
> identidade não foi conferida. Antes de restaurar, confirmar que a URL é a
> branch `production` do projeto `polished-shape-42069569` e nenhuma outra.

> **Passo 11 é o esquecido.** O webhook da Meta e o do Asaas apontam para o
> domínio antigo. Se o DNS mudar e os webhooks não, a mensagem para de chegar e
> o sintoma é "o WhatsApp parou", não "o webhook está errado".

### Reversão

Até o passo 10 (DNS), reverter é voltar o passo 3: a VPS está intacta. Depois do
10, é voltar o registro de DNS e religar o `app`/`worker` — com a ressalva de
que mensagens recebidas no intervalo chegaram ao Neon e não à VPS, e precisariam
ser copiadas de volta. Por isso o passo 12 observa **antes** de qualquer
desligamento.

---

## Fase D — Depois

1. **Não desligar nada por 14 dias.** VPS, volumes, dumps e credenciais ficam
   íntegros. Prazo a confirmar com o André.
2. Observar: taxa de erro do Worker, latência ao Neon, fila travada,
   reconexão de WebSocket, os 13 crons disparando.
3. Varrer o **histórico do git** por credencial antes de desligar a infra velha.
   Já apareceu senha de Postgres em texto puro commitada em outro projeto da
   Venn360; apagar o arquivo não tira do histórico.
4. Rotacionar tudo que esteve na VPS: senha do Postgres, service role key,
   chaves do Evolution.
5. Só então ⚠️ desligar, na ordem: `app` e `worker` → Supabase → Redis →
   Evolution (**último**, e só depois da POC provada em produção) → a VPS.

Checklist completo em [`04-post-migration-checklist.md`](04-post-migration-checklist.md).
