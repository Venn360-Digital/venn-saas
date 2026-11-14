-- ---------------------------------------------------------------------------
-- NOTA DE PORTABILIDADE — acrescentada em 2026-10-21, na migração para Neon
-- ---------------------------------------------------------------------------
-- Tudo abaixo foi escrito para o Supabase, e **cada parte** depende de algo que
-- só existe lá. No Neon esta migração falhava na primeira linha de SQL com
-- `schema "auth" does not exist`, e foi assim que isto apareceu.
--
-- O que cada premissa era, e o que acontece com ela:
--
--   `auth.uid()`          — função do Supabase Auth. Não existe no Neon, e com o
--                           Better Auth a sessão não chega ao banco: ela é
--                           resolvida pela aplicação. Impossível de portar como
--                           está.
--   PostgREST + chave anon — a razão de ser do RLS aqui. O Neon não expõe REST
--                           sobre `public` (a Data API é opt-in e não está
--                           provisionada) e não há chave anon no navegador. A
--                           porta que o RLS trancava deixa de existir.
--   `postgres_changes`    — avaliava RLS como o assinante, e é por isso que
--                           `conversations` e `messages` ganharam política. O
--                           tempo real passa a ser Durable Objects, autorizados
--                           no handshake **pelo servidor**, por sessão e
--                           workspaceId.
--   `REPLICA IDENTITY FULL` — existia para o Realtime poder avaliar RLS em
--                           UPDATE/DELETE, ao custo de WAL extra em cada recibo
--                           de entrega de mensagem. No Neon esse custo compra
--                           zero.
--
-- **O que foi preservado, e por quê.** O `ENABLE ROW LEVEL SECURITY` nas 27
-- tabelas continua rodando em todo lugar. No Neon a aplicação conecta como dona
-- das tabelas, que ignora RLS, então habilitar é inofensivo — e mantém a
-- postura de negar por omissão para qualquer papel futuro que não seja o dono.
-- É barato e falha na direção certa.
--
-- **O que foi condicionado.** A função de associação, as duas políticas, a
-- publicação e o `REPLICA IDENTITY` só se aplicam onde o schema `auth` existe,
-- ou seja, no Supabase. No Neon viram no-op, e a defesa de inquilino fica onde
-- ela sempre esteve de verdade: `src/lib/auth/workspace.ts`, validando
-- workspaceId no servidor a cada pedido.
--
-- Isto NÃO é abrir mão de defesa em profundidade por conveniência: é retirar um
-- controle junto com a exposição que ele compensava. Ver
-- `docs/migration/01-compatibility.md` §13.

-- Row Level Security for every application table.
--
-- Why this is not optional. PostgREST exposes the `public` schema to the `anon`
-- role, and the anon key ships inside the browser bundle — it is public by design.
-- Without RLS, `GET /rest/v1/contacts` with that key returns the whole contacts
-- table to anyone who opens the app. Verified on the target host: PGRST_DB_SCHEMAS
-- includes `public`, `anon` holds USAGE on it, and neither `anon` nor
-- `authenticated` has BYPASSRLS. Removing the application's own PostgREST usage
-- did not remove the endpoint — `supabase-rest` still runs and still answers.
--
-- The shape: deny by default, permit two tables.
--
-- RLS is enabled on all 27 tables, but only `conversations` and `messages` get a
-- policy. Those two are the only ones read outside the server: the inbox
-- subscribes to Realtime's postgres_changes on them, and postgres_changes
-- evaluates RLS *as the subscriber* — with no permissive policy it silently
-- delivers nothing, which looks like a screen that never updates and logs no
-- error. Every other table is read only through Prisma, which connects as
-- `postgres` and bypasses RLS, so leaving them with no policy at all is both safe
-- and correct: PostgREST gets nothing, and the application is unaffected.
--
-- Deny-all rather than a permissive policy everywhere is the deliberate choice. A
-- read added from the browser later will come back empty instead of leaking, which
-- is the direction a mistake should fail in.
--
-- SELECT only. Writes all go through Prisma, so no INSERT/UPDATE/DELETE policy is
-- wanted anywhere — their absence is what stops PostgREST writing at all. `anon`
-- gets no policy on any table, so it sees nothing regardless of role.
--
-- This sits below the workspaceId checks in src/lib/auth/workspace.ts as a second
-- line. It would, on its own, have blocked all six cross-tenant defects the audit
-- found.

-- ---------------------------------------------------------------------------
-- Membership helper
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it reads workspace_users as the owner, who bypasses RLS —
-- otherwise a policy consulting this function would recurse into workspace_users'
-- own RLS. STABLE lets the planner call it once per statement rather than per row.
-- An explicit search_path keeps a caller from shadowing `public` with their own
-- schema, which is the standard hazard of SECURITY DEFINER.
-- Condicionada: o corpo chama `auth.uid()`, e `CREATE FUNCTION` em SQL valida o
-- corpo na criação, então nem declarar é possível sem o schema `auth`.
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    EXECUTE $cria$
      CREATE OR REPLACE FUNCTION public.current_workspace_ids()
      RETURNS SETOF text
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $corpo$
        SELECT wu."workspaceId"
        FROM public.workspace_users wu
        WHERE wu."userId" = auth.uid()::text
          AND wu."isActive" = true
      $corpo$
    $cria$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.current_workspace_ids() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.current_workspace_ids() TO authenticated';
  END IF;
END $outer$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere, with no policy
-- ---------------------------------------------------------------------------
-- Enabled but unpoliced means: denied for anon and authenticated, untouched for
-- postgres. The two Realtime tables get their policy below.
DO $$
DECLARE
  t text;
  all_tables text[] := ARRAY[
    'activities', 'agencies', 'agent_custom_fields', 'agent_integrations',
    'agent_rules', 'agent_webhooks', 'agents', 'contact_tags', 'contacts',
    'conversation_tags', 'conversations', 'custom_field_definitions', 'deals',
    'departments', 'integrations', 'knowledge_documents', 'medias', 'messages',
    'pipeline_stages', 'products_services', 'quick_responses', 'subscriptions',
    'tags', 'usage_logs', 'users', 'workspace_users', 'workspaces'
  ];
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- The two tables the inbox subscribes to
-- ---------------------------------------------------------------------------
-- Condicionadas: ambas chamam `current_workspace_ids()`, que só existe onde
-- `auth` existe. E o papel `authenticated` é do Supabase: no Neon ele não há.
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    EXECUTE 'DROP POLICY IF EXISTS conversations_member_select ON public.conversations';
    EXECUTE $pol$
      CREATE POLICY conversations_member_select ON public.conversations
        FOR SELECT TO authenticated
        USING ("workspaceId" IN (SELECT public.current_workspace_ids()))
    $pol$;

    EXECUTE 'DROP POLICY IF EXISTS messages_member_select ON public.messages';
    EXECUTE $pol$
      CREATE POLICY messages_member_select ON public.messages
        FOR SELECT TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.conversations c
          WHERE c.id = messages."conversationId"
            AND c."workspaceId" IN (SELECT public.current_workspace_ids())
        ))
    $pol$;
  END IF;
END $outer$;

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
-- `supabase_realtime` ships with puballtables = false, so a table emits nothing
-- until it is added. Only these two are added: every table in the publication
-- costs WAL decoding for changes nobody listens to.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
  END IF;
END $$;

-- Realtime needs the whole previous row to evaluate RLS on UPDATE and DELETE. With
-- the default replica identity only the primary key is published, so a policy that
-- reads any other column — `messages` reads conversationId — cannot be evaluated
-- and the event is dropped. The cost is extra WAL per update, accepted knowingly:
-- `messages` is updated on every delivery receipt.
-- Condicionado à publicação do Realtime. Sem ela, `REPLICA IDENTITY FULL` é só
-- WAL extra em cada UPDATE de `messages` — e `messages` é atualizada a cada
-- recibo de entrega.
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    EXECUTE 'ALTER TABLE public.conversations REPLICA IDENTITY FULL';
    EXECUTE 'ALTER TABLE public.messages REPLICA IDENTITY FULL';
  END IF;
END $outer$;
