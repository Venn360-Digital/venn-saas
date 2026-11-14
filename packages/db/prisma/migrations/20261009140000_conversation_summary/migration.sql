-- O resumo por IA da conversa, guardado.
--
-- Gerar custa crédito do cliente; sem persistência, cada abertura do painel
-- cobraria outra vez pelo mesmo texto. `summary_until_id` registra a última
-- mensagem lida pelo resumo, para que a tela saiba se vale regerar.
ALTER TABLE "conversations"
    ADD COLUMN "summaryText" TEXT,
    ADD COLUMN "summaryAt" TIMESTAMP(3),
    ADD COLUMN "summaryUntilId" TEXT;
