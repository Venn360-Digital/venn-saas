-- Separação de roles — branch `production` do projeto Neon `odontobox`.
-- Runbook: infra/runbook/19-separacao-de-roles-neon.md
--
-- Rodar NO EDITOR SQL DO CONSOLE DA NEON, com a branch `production`
-- selecionada e o banco `neondb`. O console conecta como `neondb_owner`, que é
-- o que este bloco espera.
--
-- Validado na branch `staging` em 16/11/2026 e na branch de ensaio
-- `ensaio-roles-migrator`. Em relação ao staging, este bloco acrescenta a
-- função e os GRANT EXECUTE: produção tem 1 função com dono `neondb_owner`.
--
-- NÃO troca o dono do banco e NÃO mexe na senha do `neondb_owner` — a
-- aplicação continua conectando como hoje, e segue funcionando porque
-- `neondb_owner` passa a ser membro de `odontobox_migrator`.
--
-- As extensões (pg_trgm, unaccent, vector) ficam com o dono atual: ALTER
-- EXTENSION não aceita OWNER TO, e elas já existem.

BEGIN;

CREATE ROLE odontobox_migrator WITH LOGIN;
CREATE ROLE odontobox_app WITH LOGIN;

GRANT odontobox_migrator TO neondb_owner;
GRANT USAGE, CREATE ON SCHEMA public TO odontobox_migrator;

-- Tabelas, views, matviews e sequences. Os 232 índices seguem a tabela.
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

-- A função que só existe em produção.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn, p.prokind
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'neondb_owner'
  LOOP
    IF r.prokind = 'a' THEN
      EXECUTE format('ALTER AGGREGATE %s OWNER TO odontobox_migrator', r.fn);
    ELSE
      EXECUTE format('ALTER FUNCTION %s OWNER TO odontobox_migrator', r.fn);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO odontobox_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO odontobox_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO odontobox_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO odontobox_app;

ALTER DEFAULT PRIVILEGES FOR ROLE odontobox_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO odontobox_app;
ALTER DEFAULT PRIVILEGES FOR ROLE odontobox_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO odontobox_app;
ALTER DEFAULT PRIVILEGES FOR ROLE odontobox_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO odontobox_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Decisão A: o RLS das 27 tabelas não tem política nenhuma e nunca protegeu.
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

COMMIT;
