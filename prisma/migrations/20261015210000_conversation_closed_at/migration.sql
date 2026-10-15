-- Quando a conversa foi finalizada pela última vez.
--
-- O limite de respostas do agente conta por atendimento, e finalizar é o que
-- encerra um atendimento. Aditiva e anulável: conversa que nunca foi finalizada
-- fica com NULL, e a contagem cai na janela de tempo que serve de rede.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

-- Conversa que já está finalizada agora recebe uma marca, senão a contagem dela
-- seguiria vitalícia até a próxima finalização. `updatedAt` é a melhor
-- aproximação que existe do momento em que ela foi fechada.
UPDATE "conversations" SET "closedAt" = "updatedAt" WHERE "status" = 'closed' AND "closedAt" IS NULL;
