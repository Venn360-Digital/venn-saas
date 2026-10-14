-- N linhas de WhatsApp por agente, e cada conversa na linha por onde entrou.
--
-- Três coisas, nesta ordem, porque a terceira depende da segunda:
--
--   1. `conversations.integrationId` — a linha do fio. Preenchida para o
--      histórico a partir da única linha que cada agente tem hoje, que é
--      exatamente a dedução que deixa de ser possível depois desta migração.
--   2. `agent_integrations.phoneNumber` — o número, que até agora só existia
--      dentro do JSON de `config`. A coluna e seu índice único parcial foram
--      criados em 20261007120000 e nunca escritos: o guarda que impedia o mesmo
--      número em dois workspaces estava desligado. Com N linhas por agente o
--      número passa a ser a identidade da linha na tela, então ele sai do JSON.
--   3. `agent_integrations_agentId_channel_key` — a restrição que limitava o
--      agente a um número por canal, derrubada por último.

ALTER TABLE "agent_integrations" ADD COLUMN IF NOT EXISTS "label" TEXT;

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "integrationId" TEXT;

CREATE INDEX IF NOT EXISTS "conversations_integrationId_idx"
  ON "conversations"("integrationId");

CREATE INDEX IF NOT EXISTS "agent_integrations_agentId_channel_idx"
  ON "agent_integrations"("agentId", "channel");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_integrationId_fkey'
  ) THEN
    ALTER TABLE "conversations"
      ADD CONSTRAINT "conversations_integrationId_fkey"
      FOREIGN KEY ("integrationId") REFERENCES "agent_integrations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- (1) A linha do histórico, deduzida enquanto a dedução é única: só quando o
-- agente da conversa tem exatamente uma linha de WhatsApp. Com duas, não há
-- como saber por qual o paciente escreveu, e um palpite marcaria o fio com a
-- linha errada — pior que deixar nulo, que a tela sabe apresentar.
UPDATE "conversations" c
SET "integrationId" = u.id
FROM (
  SELECT "agentId", min(id) AS id
  FROM "agent_integrations"
  WHERE channel IN ('whatsapp_qr', 'whatsapp_business')
  GROUP BY "agentId"
  HAVING count(*) = 1
) u
WHERE c."agentId" = u."agentId"
  AND c.channel = 'whatsapp'
  AND c."integrationId" IS NULL;

-- (2) O número sai do JSON para a coluna, e só onde não cria ambiguidade: um
-- mesmo número em duas linhas violaria o índice único parcial e derrubaria a
-- migração inteira. Nesse caso a coluna fica nula e a tela segue lendo o JSON.
UPDATE "agent_integrations" i
SET "phoneNumber" = u.phone
FROM (
  SELECT id, config->>'phoneNumber' AS phone
  FROM "agent_integrations"
  WHERE config->>'phoneNumber' IS NOT NULL
    AND config->>'phoneNumber' <> ''
) u
WHERE i.id = u.id
  AND i."phoneNumber" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "agent_integrations" o
    WHERE o.id <> u.id
      AND (o."phoneNumber" = u.phone OR o.config->>'phoneNumber' = u.phone)
  );

-- (3) E por fim a restrição que dizia "um número por agente".
DROP INDEX IF EXISTS "agent_integrations_agentId_channel_key";

-- E de quem é a fila de cada linha. Nulo é a fila geral da clínica, que é o
-- estado de hoje e o de quem não usa departamentos — por isso não há backfill.
ALTER TABLE "agent_integrations" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;

CREATE INDEX IF NOT EXISTS "agent_integrations_departmentId_idx"
  ON "agent_integrations"("departmentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_integrations_departmentId_fkey'
  ) THEN
    ALTER TABLE "agent_integrations"
      ADD CONSTRAINT "agent_integrations_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
