-- Recados entre as pessoas da equipe.
--
-- O caminho de ENTREGA é o tempo real efêmero (`transmitir`, direto para o
-- Durable Object da unidade): recado que chega um minuto depois não serve, e o
-- outbox custa uma gravação mais a varredura de cada minuto. Esta tabela é a
-- outra metade — quem estava offline acha o recado ao voltar, e o contador de
-- não lidos não depende de a aba ter estado aberta na hora. Tempo real entrega;
-- a tabela lembra.
--
-- Aditiva de ponta a ponta: uma tabela nova e nada mais. Nenhuma coluna
-- existente muda de tipo, de default ou de obrigatoriedade, então o código que
-- está no ar continua funcionando sem enxergar nada disto — que é o que permite
-- aplicar a migração antes do deploy.

CREATE TABLE "team_messages" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_messages_pkey" PRIMARY KEY ("id")
);

-- A caixa de entrada: "os meus não lidos" é a consulta do contador, e ela roda
-- em toda carga de tela.
CREATE INDEX "team_messages_workspaceId_toUserId_readAt_idx"
    ON "team_messages"("workspaceId", "toUserId", "readAt");

-- A conversa com uma pessoa, em ordem. Composto e não dois índices soltos: a
-- consulta filtra os três campos juntos e ordena pelo quarto.
CREATE INDEX "team_messages_workspaceId_toUserId_fromUserId_createdAt_idx"
    ON "team_messages"("workspaceId", "toUserId", "fromUserId", "createdAt");

-- CASCADE nos três: recado é do contexto da unidade e das duas pessoas. Quem
-- sai da conta não deixa recado órfão apontando para um usuário que não existe,
-- e unidade apagada leva os seus recados junto.
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
