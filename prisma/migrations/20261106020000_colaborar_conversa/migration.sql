-- Quem colabora numa conversa sem ser o responsável por ela, e o recado que carrega de onde veio.
--
-- Expand puro: uma tabela nova e duas colunas opcionais. Nada é reescrito,
-- nada fica obrigatório, e o código antigo continua funcionando sem ver nada
-- disto — é o que permite aplicar a migração antes do deploy.

CREATE TABLE "conversation_collaborators" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_collaborators_pkey" PRIMARY KEY ("conversationId","userId")
);

-- O caminho quente é "as conversas em que eu colaboro" — o filtro da coluna.
CREATE INDEX "conversation_collaborators_userId_idx" ON "conversation_collaborators"("userId");

ALTER TABLE "conversation_collaborators"
    ADD CONSTRAINT "conversation_collaborators_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_collaborators"
    ADD CONSTRAINT "conversation_collaborators_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull: quem colabora não para de colaborar porque quem o chamou saiu da clínica.
ALTER TABLE "conversation_collaborators"
    ADD CONSTRAINT "conversation_collaborators_addedByUserId_fkey"
    FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O recado passa a poder apontar de onde veio.
ALTER TABLE "team_messages" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "team_messages" ADD COLUMN "messageId" TEXT;

-- SetNull nos dois: apagar a conversa não pode apagar o recado. O que a colega
-- escreveu continua sendo parte da conversa *dela*; só o atalho deixa de existir.
ALTER TABLE "team_messages"
    ADD CONSTRAINT "team_messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "team_messages"
    ADD CONSTRAINT "team_messages_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
