-- A agenda ganha quem atende, quando, e quando a clínica fecha.
--
-- Nada aqui tem backfill: são conceitos novos. Uma clínica que não cadastrar
-- especialista nenhum continua marcando atividade como marca hoje — a coluna
-- fica nula e a agenda desenha igual.

-- O Item passa a saber quanto tempo um procedimento ocupa. Nulo em tudo que não
-- é procedimento, que é o estado de todos os itens de hoje.
ALTER TABLE "products_services" ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;

CREATE TABLE IF NOT EXISTS "specialists" (
    "id"          TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "specialty"   TEXT,
    "color"       TEXT NOT NULL DEFAULT '#06B6D4',
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "userId"      TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "specialists_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "specialists_workspaceId_idx" ON "specialists"("workspaceId");

CREATE TABLE IF NOT EXISTS "specialist_windows" (
    "id"           TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "weekday"      INTEGER NOT NULL,
    "startTime"    TEXT NOT NULL,
    "endTime"      TEXT NOT NULL,
    "agentCanBook" BOOLEAN NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "specialist_windows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "specialist_windows_specialistId_idx" ON "specialist_windows"("specialistId");

CREATE TABLE IF NOT EXISTS "specialist_window_procedures" (
    "windowId"         TEXT NOT NULL,
    "productServiceId" TEXT NOT NULL,
    CONSTRAINT "specialist_window_procedures_pkey" PRIMARY KEY ("windowId", "productServiceId")
);
CREATE INDEX IF NOT EXISTS "specialist_window_procedures_productServiceId_idx"
    ON "specialist_window_procedures"("productServiceId");

CREATE TABLE IF NOT EXISTS "schedule_exceptions" (
    "id"          TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "holidayKey"  TEXT,
    "name"        TEXT NOT NULL,
    "startsOn"    DATE,
    "endsOn"      DATE,
    "allDay"      BOOLEAN NOT NULL DEFAULT true,
    "startTime"   TEXT,
    "endTime"     TEXT,
    "blocks"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "schedule_exceptions_workspaceId_idx" ON "schedule_exceptions"("workspaceId");
-- Um feriado nacional tem no máximo uma decisão por clínica. Parcial porque as
-- entradas próprias da clínica têm `holidayKey` nulo e não competem entre si.
CREATE UNIQUE INDEX IF NOT EXISTS "schedule_exceptions_workspaceId_holidayKey_key"
    ON "schedule_exceptions"("workspaceId", "holidayKey") WHERE "holidayKey" IS NOT NULL;

-- A atividade passa a saber quem executa e o que é feito.
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "specialistId" TEXT;
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "productServiceId" TEXT;
CREATE INDEX IF NOT EXISTS "activities_specialistId_idx" ON "activities"("specialistId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialists_workspaceId_fkey') THEN
    ALTER TABLE "specialists" ADD CONSTRAINT "specialists_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialists_userId_fkey') THEN
    ALTER TABLE "specialists" ADD CONSTRAINT "specialists_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialist_windows_specialistId_fkey') THEN
    ALTER TABLE "specialist_windows" ADD CONSTRAINT "specialist_windows_specialistId_fkey"
      FOREIGN KEY ("specialistId") REFERENCES "specialists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialist_window_procedures_windowId_fkey') THEN
    ALTER TABLE "specialist_window_procedures" ADD CONSTRAINT "specialist_window_procedures_windowId_fkey"
      FOREIGN KEY ("windowId") REFERENCES "specialist_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialist_window_procedures_productServiceId_fkey') THEN
    ALTER TABLE "specialist_window_procedures" ADD CONSTRAINT "specialist_window_procedures_productServiceId_fkey"
      FOREIGN KEY ("productServiceId") REFERENCES "products_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_exceptions_workspaceId_fkey') THEN
    ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_specialistId_fkey') THEN
    ALTER TABLE "activities" ADD CONSTRAINT "activities_specialistId_fkey"
      FOREIGN KEY ("specialistId") REFERENCES "specialists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_productServiceId_fkey') THEN
    ALTER TABLE "activities" ADD CONSTRAINT "activities_productServiceId_fkey"
      FOREIGN KEY ("productServiceId") REFERENCES "products_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
