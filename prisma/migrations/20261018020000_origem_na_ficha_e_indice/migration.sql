-- A origem que estava só no negócio sobe para a ficha, e um índice que faltava.
--
-- Achados na revisão depois de `20261017120000_origem_unica`.
--
-- (1) A unificação da lista deixou os dados pela metade. A clínica tinha
--     origem preenchida em 7 negócios (era `deals.agencyId`) e em **nenhuma**
--     ficha, porque a coluna antiga do paciente nunca guardou origem comercial
--     de verdade — guardava canal. Só que o gráfico de origem do Dashboard
--     passou a agrupar **paciente** por origem, então ele mostrava "Sem
--     origem" para todo mundo enquanto a informação existia ao lado.
--
--     O negócio mais antigo de cada paciente é o que diz como ele chegou: os
--     seguintes são recompra, e a origem de aquisição é a da primeira vez.
--
-- (2) `conversations.assignedTo` não tinha índice, e passou a ser filtrada em
--     dois caminhos quentes: a lista de conversas nas guias Ativas e
--     Finalizadas do atendente, e agora o recorte de Pacientes, que pergunta
--     "este paciente tem conversa atribuída a mim?" em toda listagem. Com os
--     dados de homologação não dói; numa clínica com milhares de conversas é
--     varredura de tabela a cada tela.

-- (1) Só onde a ficha não tem origem: quem já tem foi preenchido por alguém, e
-- a escolha de uma pessoa ganha de uma dedução nossa.
UPDATE "contacts" c
SET "originId" = d."originId"
FROM (
    SELECT DISTINCT ON ("contactId") "contactId", "originId"
    FROM "deals"
    WHERE "originId" IS NOT NULL
      AND "contactId" IS NOT NULL
    ORDER BY "contactId", "createdAt" ASC
) d
WHERE c."id" = d."contactId"
  AND c."originId" IS NULL;

-- (2) O índice.
CREATE INDEX IF NOT EXISTS "conversations_assignedTo_idx"
  ON "conversations"("assignedTo");
