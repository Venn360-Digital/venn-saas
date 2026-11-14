-- O percurso do negócio pelas etapas da clínica. `deals.stageId` continua sendo
-- a posição atual; isto é o histórico, que antes não existia.
CREATE TABLE "deal_stage_entries" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deal_stage_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deal_stage_entries_dealId_enteredAt_idx" ON "deal_stage_entries"("dealId", "enteredAt");
CREATE INDEX "deal_stage_entries_stageId_idx" ON "deal_stage_entries"("stageId");

ALTER TABLE "deal_stage_entries" ADD CONSTRAINT "deal_stage_entries_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_stage_entries" ADD CONSTRAINT "deal_stage_entries_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A etapa em que cada negócio está hoje passa a ter uma entrada, para o trilho
-- não nascer sem data. `updatedAt` é a melhor evidência disponível de quando ele
-- chegou ali; não se inventa data para as etapas anteriores, que ficam em branco
-- até alguém registrar. Sem nota: nota em branco é honesta, nota explicando a
-- migração apareceria no painel como se fosse observação da clínica.
INSERT INTO "deal_stage_entries" ("id", "dealId", "stageId", "enteredAt")
SELECT 'seed_' || "id", "id", "stageId", COALESCE("updatedAt", "createdAt")
FROM "deals";

-- O modelo antigo sai de cena: a jornada de seis marcos fixos era o outro
-- vocabulário, e manter o JSON preenchido deixaria dado morto aparecendo em
-- tela. Os negócios existentes são de teste.
UPDATE "deals" SET "trackingData" = NULL;
