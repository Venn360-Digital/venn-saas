# 19 — Separação de roles no Neon (correção do odontobox)

**Onde executar:** MCP da Neon. **Modo:** Plan mode, R5 antes de cada escrita.
**Ensaiado em** 15/11/2026, na branch `ensaio-roles-migrator`
(`br-round-art-b6duc6jk`) do projeto `odontobox`, criada de `production`.
Todo SQL abaixo foi rodado lá e verificado pelo catálogo.

## O desvio

| Projeto Neon | Criado | Banco | Roles em `production` |
|---|---|---|---|
| odontobox | 21/10, pelo console | `neondb` / `neondb_owner` | só `neondb_owner` |
| conecta | 27/10, por script | `conecta` / `conecta_migrator` | `conecta_migrator`, `conecta_app`, `neondb_owner` |
| stagent | 27/10, por script | `stagent` / `stagent_migrator` | `stagent_migrator`, `stagent_app`, `neondb_owner` |

A causa está nas datas e no título da Fase 06: "Banco de dados (Neon) **do novo
app**". Ela foi escrita para criar os clones, e o odontobox era o modelo que ela
copiava — nunca o objeto dela. Então o odontobox roda com UMA role, que é dona
do schema e do banco: a aplicação e as migrações usam o mesmo privilégio, e
`DATABASE_URL_MIGRATOR` e `DATABASE_URL` apontam para a mesma coisa.

É o app das clínicas. É onde a separação de privilégio mais importa.

## O que o ensaio descobriu, e muda o plano

**1. O RLS dos três apps é inerte.** 27 das 76 tabelas têm
`ENABLE ROW LEVEL SECURITY` e **zero políticas** — idêntico no odontobox e no
conecta, herança da era Supabase. Nenhuma tem `FORCE ROW LEVEL SECURITY`, então
o dono da tabela ignora o RLS, e toda role que conecta hoje é dona ou tem
`BYPASSRLS`. As políticas não protegem nada e nunca protegeram.

A consequência é uma armadilha: RLS ligado **sem política** nega todas as linhas
a quem não é dono e não tem `BYPASSRLS`. No dia em que a aplicação apontar para
uma role de menor privilégio, as 27 tabelas devolvem zero linhas — e o sintoma
parece falha de conexão, não de permissão.

**2. As roles dos clones não são de menor privilégio.** `conecta_app` e
`stagent_app` foram criadas pela API da Neon com o acesso padrão (`admin`), que
entra em `neon_superuser`: `rolbypassrls`, `rolcreatedb` e `rolcreaterole` todos
verdadeiros. Copiar os clones reproduziria isso. A role criada por SQL no ensaio
(`odontobox_app`) saiu com os três **falsos** — é esta a forma correta.

**3. Trocar o dono do banco por uma role NOLOGIN quebra quem conecta "como dono
do banco".** Medido: depois de `ALTER DATABASE neondb OWNER TO
odontobox_migrator`, o MCP da Neon passou a responder
`missing authentication credentials: required password` em qualquer consulta,
porque resolve o dono do banco e ele não tinha senha. Com `role_name` explícito,
voltou.

**A conclusão do ensaio foi melhor que o plano: o `ALTER DATABASE OWNER` é
DISPENSÁVEL.** Ele existia no plano só para o migrator herdar `CREATE` no schema
por ser `pg_database_owner` — e um `GRANT USAGE, CREATE ON SCHEMA public`
explícito faz o mesmo sem efeito colateral. O banco fica com `neondb_owner`, e
nada que resolva "o dono do banco" quebra. É assim que staging foi aplicado.
A divergência de estrutura com os clones (lá o migrator é dono do banco) fica
registrada de propósito: ela não compra segurança e custa ferramental.

**4. `REASSIGN OWNED` não serve.** Exige poder `SET ROLE` no destino e falha com
`42501`. E `ALTER TABLE ... OWNER TO` exige que o NOVO dono tenha `CREATE` no
schema — nos clones isso vem de graça porque lá o migrator é dono do banco. A
reatribuição vai objeto por objeto, depois de resolver a propriedade do banco.

## A decisão que precede a execução

A aplicação só ganha algo quando passa a conectar como `{slug}_app`. Para isso,
o RLS inerte tem de sair do caminho. Duas saídas:

- **A (recomendada):** `DISABLE ROW LEVEL SECURITY` nas 27 tabelas e a aplicação
  passa a rodar com uma role que **não** tem `BYPASSRLS` e **não** tem DDL. O
  isolamento continua onde sempre esteve de fato: no filtro por workspace da
  aplicação, provado por `audit-isolation --strict` no portão. Resultado líquido:
  mais seguro que hoje e que os clones.
- **B:** manter o RLS ligado e dar `BYPASSRLS` ao app — é o estado atual dos
  clones. Mantém um flag que não protege e exige uma role mais poderosa. Pior.

Escrever políticas de verdade é um projeto à parte, e reproduziria o
comportamento de hoje com mais peças móveis.

## O SQL, na ordem que funcionou

Rode por branch, `staging` primeiro. Substitua `{slug}` e, no odontobox, o banco
é `neondb` (a divergência de NOME do banco fica: renomear exigiria a aplicação
fora do ar e não compra segurança nenhuma).

1. **Crie as roles por SQL, como `NOLOGIN`** (está na transação do passo 2).
   **Não** use o botão de criar role do console nem a API da Neon com acesso
   `admin`: esse caminho põe a role em `neon_superuser`, o que traz
   `BYPASSRLS`, `CREATEDB` e `CREATEROLE` — e a Neon avisa que `admin` não pode
   ser estreitado depois. É exatamente o defeito que os clones têm.

   A senha vem depois, no passo 4, e nunca passa por chat nem por log.

   **Consequência medida em 16/11/2026:** role criada por SQL fica fora do cofre
   de credenciais da Neon. `reset_postgres_role_password` responde
   `422 cannot update password for role without password`, o console não exibe
   connection string dela, e nenhuma ferramenta que peça "a string da role" a
   encontra. É o preço de não passar por `neon_superuser` — e é um preço barato:
   a string é montada uma vez, à mão, e guardada no cofre.

2. Com `role_name` = `neondb_owner`, nesta ordem, em UMA transação:

```sql
GRANT odontobox_migrator TO neondb_owner;
-- NÃO troque o dono do banco: o GRANT abaixo já dá ao migrator o CREATE que o
-- ALTER TABLE ... OWNER TO exige. Ver a lição 3.
GRANT USAGE, CREATE ON SCHEMA public TO odontobox_migrator;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS obj, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
  LOOP
    IF r.relkind IN ('r','p') THEN
      EXECUTE format('ALTER TABLE %s OWNER TO odontobox_migrator', r.obj);
    ELSIF r.relkind = 'v' THEN
      EXECUTE format('ALTER VIEW %s OWNER TO odontobox_migrator', r.obj);
    ELSIF r.relkind = 'm' THEN
      EXECUTE format('ALTER MATERIALIZED VIEW %s OWNER TO odontobox_migrator', r.obj);
    ELSIF r.relkind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE %s OWNER TO odontobox_migrator', r.obj);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO odontobox_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO odontobox_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO odontobox_app;
ALTER DEFAULT PRIVILEGES FOR ROLE odontobox_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO odontobox_app;
ALTER DEFAULT PRIVILEGES FOR ROLE odontobox_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO odontobox_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

3. **Só na opção A**, e só depois de decidida:

```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS obj
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', r.obj);
  END LOOP;
END $$;
```

4. Dê a senha às duas roles, no editor SQL do console da Neon (o `WITH LOGIN`
   já foi aplicado em staging em 16/11/2026):

```sql
ALTER ROLE odontobox_migrator WITH PASSWORD '<senha forte>';
ALTER ROLE odontobox_app      WITH PASSWORD '<outra senha forte>';
```

   Monte a string à mão, **direta, não pooled**, com `sslmode=require`:

```
postgresql://<role>:<senha>@<host>/neondb?sslmode=require
```

   Hosts read-write diretos do projeto `odontobox`:

   | Branch | Host |
   |---|---|
   | `staging` | `ep-lucky-pond-b6n42j1j.c-2.sa-east-1.aws.neon.tech` |
   | `production` | `ep-icy-mode-b6mp2z8h.c-2.sa-east-1.aws.neon.tech` |

   Senhas diferentes por branch: as quatro credenciais (2 roles × 2 branches)
   não se repetem.

5. Salve em `~/.venn360-secrets/odontobox/neon-production.env` e
   `neon-staging.env`, com as chaves `DATABASE_URL_MIGRATOR` e
   `DATABASE_URL_APP` — é o que o runbook da Fase 06 manda e o que faltava nesta
   pasta.

6. Troque as credenciais em uso: `DATABASE_URL` da aplicação para
   `{slug}_app` (secret do Worker) e `DATABASE_URL_MIGRATOR` do build para
   `{slug}_migrator` (build variable).

## Aceite (rodar com a connection string real, em staging)

```sql
-- como {slug}_app: tem de devolver o número real, não zero.
-- Use uma tabela COM linhas: em staging, `contacts` está vazia e um zero
-- legítimo se confundiria com o zero do RLS.
SELECT count(*) FROM workspaces;        -- 1 em staging
SELECT count(*) FROM _prisma_migrations; -- 71 em staging
-- como {slug}_app: as três têm de FALHAR
CREATE TABLE teste_ddl (id int);
DROP TABLE contacts;
TRUNCATE contacts;
```

E pelo catálogo, conectando com role explícita:

```sql
SELECT rolname, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname LIKE '{slug}%';
-- os três booleanos da role _app têm de ser false
```

Depois: deploy de staging verde, smoke verde, 48 h de observação, e só então
produção.

## Reversão

Tudo é reversível sem perda de dado: `ALTER DATABASE neondb OWNER TO
neondb_owner`, o mesmo laço de `ALTER ... OWNER TO neondb_owner`, e
`ENABLE ROW LEVEL SECURITY` onde foi desligado. A aplicação volta a conectar com
a credencial antiga, que continua válida enquanto a role existir.

## Extensão aos clones

Conecta e stagent têm o mesmo RLS inerte e roles `_app` em `neon_superuser`.
A correção completa nos dois é: desligar o RLS inerte e **recriar** a role `_app`
com acesso `read_write` — o `admin` não pode ser estreitado depois. Entra como
problema irmão, pelos mesmos portões, depois de o odontobox estar estável.

## Quando

Antes da Fase 4 do monorepo, que cria o baseline nos seis bancos. Nunca dentro
de uma janela de cutover (F5–F7).

## Aplicado

**Branch `staging` do odontobox — 16/11/2026.** Decisão A (desligar o RLS
inerte), tomada pelo André. Verificado pelo catálogo logo após:

| Conferência | Resultado |
|---|---|
| Tabelas com dono `odontobox_migrator` | 76 de 76 |
| Dono do banco | `neondb_owner` (intocado, de propósito) |
| Tabelas ainda com RLS | 0 de 76 (eram 27) |
| `odontobox_app` cria no schema | não |
| `odontobox_app` tem SELECT | sim |
| `odontobox_app` trunca | não |
| `odontobox_app` em `neon_superuser` | não |
| Aplicação de staging (conecta como `neondb_owner`) | segue lendo: 1 workspace, 71 migrações |

Aceite por catálogo, conferido em 16/11/2026 depois do `WITH LOGIN`:

| Pergunta sobre `odontobox_app` | Resposta |
|---|---|
| Lê `workspaces` e `_prisma_migrations` | sim |
| INSERT / UPDATE / DELETE | sim |
| Tabelas das 76 sem SELECT para ela | 0 |
| Cria tabela no schema | **não** |
| TRUNCATE / TRIGGER / REFERENCES | **não** |
| Tabelas que ela possui (logo, poderia dropar) | **0** |
| `BYPASSRLS` / `CREATEDB` / `CREATEROLE` / `SUPERUSER` | **não, nos quatro** |
| Em `neon_superuser` | **não** |

As duas roles ficaram fora de `neon_superuser` — inclusive a `_migrator`, que
não precisa de `BYPASSRLS` porque é dona das tabelas. É mais restrito que o
estado dos clones.

A aplicação não parou porque `neondb_owner` é membro de `odontobox_migrator` e
herda os privilégios dos objetos. O ganho de segurança só se realiza no passo 6
acima, quando o `DATABASE_URL` passar a ser o da role `_app`.

**Branch `production` do odontobox — 16/11/2026.** Aplicada pelo André no
editor SQL do console (a escrita pelo MCP foi barrada pelo classificador de
permissões do auto mode). Bloco em `19-sql-producao-odontobox.sql`, que
acrescenta ao do staging a função e os `GRANT EXECUTE` — produção tinha 1 função
com dono `neondb_owner`.

Conferido logo depois:

| Conferência | Resultado |
|---|---|
| Tabelas e views com dono `odontobox_migrator` | 76 + 3, nenhuma linha com `neondb_owner` |
| Tabelas ainda com RLS | 0 de 76 (eram 27) |
| Funções ainda com dono `neondb_owner` | 0 |
| Dono do banco | `neondb_owner`, intocado |
| `odontobox_app` cria / lê / trunca | não / sim / não |
| Tabelas das 76 sem SELECT para o app | 0 |
| Objetos que o app possui | 0 |
| `BYPASSRLS` / `CREATEDB` / `CREATEROLE` / `neon_superuser` | não, nos quatro |
| Dados | 2 workspaces, 212 contatos, 70 migrações |

### Aceite executado em 16/11/2026, conectando de verdade

Senhas definidas pelo André nas duas branches (hex de 24 bytes, geradas na
máquina dele, fingerprints registrados no cofre). Teste rodado com o driver `pg`
lendo as strings do cofre, cada negativo em transação com `ROLLBACK`:

| | staging | produção |
|---|---|---|
| `odontobox_app` conectou | sim | sim |
| Leitura | 1 workspace, 71 migrações | 2 workspaces, 213 contatos, 70 migrações |
| INSERT / UPDATE / DELETE | sim | sim |
| `CREATE TABLE` | recusado 42501 | recusado 42501 |
| `TRUNCATE` | recusado 42501 | recusado 42501 |
| `DROP TABLE` | recusado 42501 | recusado 42501 |
| `ALTER TABLE` | recusado 42501 | recusado 42501 |
| `odontobox_migrator` conectou e cria no schema | sim, 76 tabelas próprias | sim, 76 tabelas próprias |

Produção registrou 212 contatos antes da mudança e 213 durante o aceite:
tráfego real entrando, sem interrupção.

**A troca de credencial da aplicação ainda NÃO foi feita em nenhum ambiente.**
Enquanto `DATABASE_URL` apontar para `neondb_owner`, a estrutura está pronta mas
o ganho de privilégio não se realizou. É o passo 6 da seção do SQL.

**Nota sobre a divergência de plano:** o staging foi aplicado antes e a produção
veio junto, sem as 48 h de espera. A espera protegia a TROCA DE CREDENCIAL, não a
mudança estrutural — que não altera o caminho da aplicação e foi provada duas
vezes antes. A troca da `_app` em produção segue esperando o staging rodar.

## Pendência

A branch de ensaio `ensaio-roles-migrator` (`br-round-art-b6duc6jk`) ficou de
pé para inspeção. Apagar depois de ler.
