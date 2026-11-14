-- O motor de follow-up: a fase diz quando cobrar, a atividade diz que nasceu sozinha.
--
-- `followUpDays` nulo é "esta fase não cobra" — e é o padrão, para que ligar a
-- automação continue sendo uma decisão da clínica, não um efeito da migração.
ALTER TABLE "pipeline_stages" ADD COLUMN "followUpDays" INTEGER;
ALTER TABLE "activities" ADD COLUMN "auto" BOOLEAN NOT NULL DEFAULT false;

-- O cron varre por fase e por data de entrada; sem isto a varredura diária
-- liga em sequencial sobre a tabela inteira de negócios.
CREATE INDEX IF NOT EXISTS "deals_workspace_status_stage_idx"
    ON "deals" ("workspaceId", "status", "stageId");
