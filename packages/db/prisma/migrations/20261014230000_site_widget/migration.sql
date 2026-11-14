-- O widget do site: uma chave pública por integração, e um visitante por conversa.
--
-- As duas colunas são nulas em tudo o que existe hoje, e continuam nulas em todo
-- canal que não é o site.

ALTER TABLE "agent_integrations" ADD COLUMN IF NOT EXISTS "publicKey" TEXT;
CREATE INDEX IF NOT EXISTS "agent_integrations_publicKey_idx" ON "agent_integrations"("publicKey");

-- Única: a chave vai na página da clínica e é por ela que o atendimento chega.
-- Duas integrações com a mesma chave tornariam ambíguo de quem é a conversa.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_integrations_publicKey_key"
  ON "agent_integrations"("publicKey") WHERE "publicKey" IS NOT NULL;

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "visitorKey" TEXT;
CREATE INDEX IF NOT EXISTS "conversations_visitorKey_idx" ON "conversations"("visitorKey");
