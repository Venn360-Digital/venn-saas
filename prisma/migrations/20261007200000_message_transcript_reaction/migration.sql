-- Nota de voz transcrita e reação enviada pela clínica.
ALTER TABLE "messages" ADD COLUMN "transcript" TEXT;
ALTER TABLE "messages" ADD COLUMN "reaction" TEXT;
