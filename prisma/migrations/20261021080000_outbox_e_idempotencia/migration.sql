-- A outbox transacional e a deduplicação de mensagens.
--
-- Duas coisas que o Supabase e o BullMQ davam de graça e que a Cloudflare não dá.
--
-- 1. O Supabase Realtime lia o WAL do Postgres: gravar a linha *era* publicar o
--    evento. O Neon não publica WAL para a Cloudflare. Então escrita no banco
--    não chega sozinha ao Durable Object, e o evento passa a ser gravado na
--    mesma transação do dado — ou existem os dois, ou nenhum.
--
-- 2. O BullMQ aceita um id de job escolhido por nós e recusa o segundo com o
--    mesmo id; é assim que um webhook reenviado não vira duas mensagens.
--    Cloudflare Queues não tem deduplicação e entrega at-least-once por
--    desenho. A dedup desce para o banco, onde a unicidade é do índice.

-- ---------------------------------------------------------------------------
-- outbox_events
-- ---------------------------------------------------------------------------
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_events_createdAt_idx" ON "outbox_events"("createdAt");
CREATE INDEX "outbox_events_workspaceId_createdAt_idx" ON "outbox_events"("workspaceId", "createdAt");

-- O índice que a varredura usa, e o único que importa para o custo.
--
-- PARCIAL: só o não publicado. A tabela cresce com todo evento já entregue, e
-- um índice sobre tudo faria a varredura pagar pelo histórico. Assim ele tem o
-- tamanho da fila pendente, que em operação normal é quase zero.
CREATE INDEX "outbox_events_pendente_idx" ON "outbox_events"("createdAt")
    WHERE "publishedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- processed_messages
-- ---------------------------------------------------------------------------
-- `chave` é a própria primária: `<fila>:<id externo>`. A unicidade é o
-- mecanismo de dedup, não um detalhe de modelagem — um INSERT que colide é a
-- resposta "já processei isto".
CREATE TABLE "processed_messages" (
    "chave" TEXT NOT NULL,
    "fila" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("chave")
);

-- Para a poda. A janela só precisa cobrir o tempo em que um provedor ainda pode
-- reenviar o mesmo evento; sem poda a tabela cresceria para sempre.
CREATE INDEX "processed_messages_expiraEm_idx" ON "processed_messages"("expiraEm");
