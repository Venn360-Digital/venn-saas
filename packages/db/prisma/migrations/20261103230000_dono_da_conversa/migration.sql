-- Dono da conversa, separado do mutex do agente.
--
-- `conversations.assignedTo` significa "um humano assumiu" e é lido por quatro
-- portões que calam o agente. Distribuir responsável por ele silenciaria o bot
-- no ato de distribuir — o oposto do pedido. Por isso o responsável nasce em
-- coluna própria, que portão nenhum lê. Ver §11 do estudo.
--
-- Aditiva de ponta a ponta: nenhuma coluna existente muda de tipo, de default
-- ou de obrigatoriedade. Código antigo continua funcionando sem enxergar nada
-- disto, que é o que permite aplicar antes do deploy.

ALTER TABLE "conversations" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "conversations" ADD COLUMN "ownerAssignedAt" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "ownerSource" TEXT;

-- Serve a "minhas conversas" e à conta de abertas por pessoa, que é o
-- desempate do balanceado.
CREATE INDEX "conversations_ownerId_idx" ON "conversations"("ownerId");

-- SetNull: quem sai da equipe não leva as conversas junto. A conversa fica sem
-- dono e é redistribuída na mensagem seguinte.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quem entra na distribuição, e em que estado está.
--
-- `recebeConversas` nasce TRUE para não exigir que ninguém reconfigure a conta
-- existente; o UPDATE abaixo desliga OWNER e ADMIN, que é o padrão certo para
-- eles. Quem é exceção — a clínica de uma pessoa só, em que o dono atende —
-- liga de volta na tela.
ALTER TABLE "workspace_users" ADD COLUMN "recebeConversas" BOOLEAN NOT NULL DEFAULT true;

-- Nasce 'ausente' de propósito: ninguém marcou nada ainda, e marcar todo mundo
-- como disponível faria a primeira distribuição com o interruptor ligado cair
-- em quem não está.
ALTER TABLE "workspace_users" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ausente';
ALTER TABLE "workspace_users" ADD COLUMN "statusEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- A queda para ausente é DERIVADA daqui, não gravada por job: "status antigo"
-- não serve como sinal, porque quem trabalha há duas horas tem o status antigo
-- e está presente. Nula = nunca agiu desde a migração, e quem nunca agiu não
-- está disponível.
ALTER TABLE "workspace_users" ADD COLUMN "ultimaAtividadeEm" TIMESTAMP(3);

UPDATE "workspace_users" SET "recebeConversas" = false WHERE "role" IN ('OWNER', 'ADMIN');
