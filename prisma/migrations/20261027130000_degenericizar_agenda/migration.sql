-- contract: RENAME com ponte — as views de compatibilidade da seção 5 mantêm
-- os nomes antigos legíveis E graváveis durante a janela entre o migrate (no
-- comando de deploy) e a publicação do Worker novo, que já fala os nomes
-- novos. A fase de remoção é a migração futura que dropa as views.
-- Degenericização da agenda: o vocabulário de atendimento deixa de ser de nicho.
--
-- RENAME (não DROP/CREATE): preserva os dados e já deixa o padrão certo para
-- quando houver carga real. Os nomes de constraint e índice também mudam, para
-- casar com a convenção do Prisma e não gerar drift no próximo `migrate dev`.
--
--   specialists                   -> professionals
--   specialist_windows            -> availability_windows   (specialistId -> professionalId)
--   specialist_window_procedures  -> availability_window_services
--   activities.specialistId       -> activities.professionalId

-- 1. Tabelas
ALTER TABLE IF EXISTS "specialists"                  RENAME TO "professionals";
ALTER TABLE IF EXISTS "specialist_windows"           RENAME TO "availability_windows";
ALTER TABLE IF EXISTS "specialist_window_procedures" RENAME TO "availability_window_services";

-- 2. Colunas
ALTER TABLE IF EXISTS "availability_windows" RENAME COLUMN "specialistId" TO "professionalId";
ALTER TABLE IF EXISTS "activities"           RENAME COLUMN "specialistId" TO "professionalId";

-- 3. Constraints (PK + FK). RENAME CONSTRAINT não aceita IF EXISTS — guardado por pg_constraint.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialists_pkey') THEN
    ALTER TABLE "professionals" RENAME CONSTRAINT "specialists_pkey" TO "professionals_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialists_workspaceId_fkey') THEN
    ALTER TABLE "professionals" RENAME CONSTRAINT "specialists_workspaceId_fkey" TO "professionals_workspaceId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialists_userId_fkey') THEN
    ALTER TABLE "professionals" RENAME CONSTRAINT "specialists_userId_fkey" TO "professionals_userId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialist_windows_pkey') THEN
    ALTER TABLE "availability_windows" RENAME CONSTRAINT "specialist_windows_pkey" TO "availability_windows_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialist_windows_specialistId_fkey') THEN
    ALTER TABLE "availability_windows" RENAME CONSTRAINT "specialist_windows_specialistId_fkey" TO "availability_windows_professionalId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialist_window_procedures_pkey') THEN
    ALTER TABLE "availability_window_services" RENAME CONSTRAINT "specialist_window_procedures_pkey" TO "availability_window_services_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialist_window_procedures_windowId_fkey') THEN
    ALTER TABLE "availability_window_services" RENAME CONSTRAINT "specialist_window_procedures_windowId_fkey" TO "availability_window_services_windowId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialist_window_procedures_productServiceId_fkey') THEN
    ALTER TABLE "availability_window_services" RENAME CONSTRAINT "specialist_window_procedures_productServiceId_fkey" TO "availability_window_services_productServiceId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_specialistId_fkey') THEN
    ALTER TABLE "activities" RENAME CONSTRAINT "activities_specialistId_fkey" TO "activities_professionalId_fkey";
  END IF;
END $$;

-- 4. Índices (os de PK seguem a constraint; estes são os CREATE INDEX avulsos)
ALTER INDEX IF EXISTS "specialists_workspaceId_idx"                     RENAME TO "professionals_workspaceId_idx";
ALTER INDEX IF EXISTS "specialist_windows_specialistId_idx"            RENAME TO "availability_windows_professionalId_idx";
ALTER INDEX IF EXISTS "specialist_window_procedures_productServiceId_idx" RENAME TO "availability_window_services_productServiceId_idx";
ALTER INDEX IF EXISTS "activities_specialistId_idx"                     RENAME TO "activities_professionalId_idx";

-- 5. Views de compatibilidade — necessárias SÓ neste produto, que roda esta
--    migração com dados e tráfego reais. Entre o `prisma migrate deploy` (que
--    o comando de deploy executa antes do publish) e a troca do Worker, o
--    Worker antigo ainda consulta os nomes antigos; views atualizáveis
--    (tabela única, sem expressão) aceitam SELECT/INSERT/UPDATE/DELETE, então
--    ele segue funcionando durante essa janela. `activities.specialistId` fica
--    de fora (a tabela não pode virar view de si mesma): escrita nessa coluna
--    pelo Worker antigo falha durante a janela — coluna de baixa escrita,
--    janela de segundos. As views saem numa migração posterior, um ciclo
--    depois (DROP VIEW IF EXISTS, inócuo nos produtos que nunca as tiveram).
CREATE VIEW "specialists" AS SELECT * FROM "professionals";
-- View não herda DEFAULT da tabela base; INSERT do Prisma omite colunas com
-- @default de banco, então os defaults precisam ser repostos na view.
ALTER VIEW "specialists" ALTER COLUMN "color" SET DEFAULT '#06B6D4';
ALTER VIEW "specialists" ALTER COLUMN "isActive" SET DEFAULT true;
ALTER VIEW "specialists" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE VIEW "specialist_windows" AS
  SELECT "id", "professionalId" AS "specialistId", "weekday", "startTime",
         "endTime", "agentCanBook", "createdAt", "updatedAt"
  FROM "availability_windows";
ALTER VIEW "specialist_windows" ALTER COLUMN "agentCanBook" SET DEFAULT false;
ALTER VIEW "specialist_windows" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE VIEW "specialist_window_procedures" AS SELECT * FROM "availability_window_services";
