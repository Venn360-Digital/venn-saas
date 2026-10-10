-- Envio automático por fase, e o descadastro do paciente.
--
-- `off` é o padrão: soltar o sistema para falar com paciente é decisão da
-- clínica, fase por fase, e nunca efeito de uma migração.
ALTER TABLE "pipeline_stages" ADD COLUMN "autoSend" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "contacts" ADD COLUMN "autoMessagesPausedAt" TIMESTAMP(3);
