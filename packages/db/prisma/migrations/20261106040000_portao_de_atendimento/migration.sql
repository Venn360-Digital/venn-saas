-- O portão "a IA ou a equipe?", e o acervo existente classificado por ele.
--
-- Expand puro: coluna nova com default, índice novo, e um UPDATE que reescreve
-- apenas a coluna que acabou de nascer. Nada do que já existia é alterado, e o
-- código anterior a esta migração continua correto porque não lê a coluna.

ALTER TABLE "conversations" ADD COLUMN "atendidaPor" TEXT NOT NULL DEFAULT 'bot';

-- O agrupamento da coluna de Conversas: as três abas são (status, atendidaPor),
-- sempre dentro de uma unidade.
CREATE INDEX "conversations_workspaceId_status_atendidaPor_idx"
    ON "conversations"("workspaceId", "status", "atendidaPor");

-- ---------------------------------------------------------------------------
-- O acervo existente
-- ---------------------------------------------------------------------------
--
-- A regra é `assignedTo IS NOT NULL`, e ela é a escolha conservadora de
-- propósito: `assignedTo` **é** o mutex do agente hoje — quatro portões leem
-- `Boolean(assignedTo)` para calar o bot. Então classificar por ele é dizer
-- sobre cada conversa antiga exatamente o que o sistema já vinha dizendo. A
-- migração não muda o comportamento de nenhuma conversa viva; ela só passa a
-- escrever em coluna própria o que estava implícito na outra.
--
-- Conferido contra um segundo sinal independente — quem mandou a última
-- mensagem de saída não interna — nas 86 conversas de produção: os dois
-- critérios concordam em 43 das 45 abertas, e as duas divergências são
-- conversas que um humano assumiu e ainda não respondeu. Essas ficam com
-- "humano", que é o certo: a conversa é dele, ele só não escreveu ainda.
--
-- Por que não inferir pelo histórico ("algum humano já respondeu alguma vez"):
-- daria praticamente o mesmo resultado hoje (43 de 45) e seria um critério que
-- envelhece errado — uma conversa de três semanas atrás respondida por alguém
-- que depois a devolveu à IA voltaria para a equipe sem que ninguém a tenha
-- assumido.
UPDATE "conversations" SET "atendidaPor" = 'humano' WHERE "assignedTo" IS NOT NULL;

-- `ownerId`, `ownerAssignedAt`, `ownerSource` e `handoffAt` **ficam**. A queda
-- delas é a fase de contract, depois de o código parar de lê-las; `ownerSource`
-- sobrevive à poda como procedência da atribuição (rodizio | ia | assumiu).
