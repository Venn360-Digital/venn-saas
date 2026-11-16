-- Conferência, logo depois do bloco. Esperado em produção do odontobox:
--   dono/relkind      -> odontobox_migrator r=76, v=3  (nenhuma linha com neondb_owner)
--   ainda_com_rls     -> 0 de 76
--   dono_do_banco     -> neondb_owner
--   objetos do app    -> 0  (ele não possui nada, logo não dropa nada)
--   leitura           -> os números reais de produção, nenhum zero inesperado
SELECT pg_get_userbyid(c.relowner) AS dono, c.relkind, count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','S')
GROUP BY 1, 2 ORDER BY 1, 2;

SELECT count(*) FILTER (WHERE relrowsecurity) AS ainda_com_rls, count(*) AS tabelas
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND relkind = 'r';

SELECT pg_get_userbyid(datdba) AS dono_do_banco FROM pg_database WHERE datname = 'neondb';

SELECT count(*) AS objetos_do_app
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = 'odontobox_app';

SELECT has_schema_privilege('odontobox_app','public','CREATE') AS app_cria,
       has_table_privilege('odontobox_app','contacts','SELECT') AS app_le,
       has_table_privilege('odontobox_app','contacts','TRUNCATE') AS app_trunca,
       pg_has_role('odontobox_app','neon_superuser','MEMBER') AS app_superuser;

SELECT (SELECT count(*) FROM workspaces) AS workspaces,
       (SELECT count(*) FROM contacts) AS contacts,
       (SELECT count(*) FROM _prisma_migrations) AS migracoes;
