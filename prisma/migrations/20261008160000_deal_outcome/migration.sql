-- Por que um negócio foi ganho ou perdido, na lista da própria clínica.
CREATE TABLE "deal_outcome_reasons" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deal_outcome_reasons_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "deal_outcome_reasons_workspaceId_kind_order_idx"
    ON "deal_outcome_reasons"("workspaceId", "kind", "order");
ALTER TABLE "deal_outcome_reasons" ADD CONSTRAINT "deal_outcome_reasons_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O desfecho no negócio: motivo, nota, fase de saída e valor fechado.
ALTER TABLE "deals" ADD COLUMN "outcomeReasonId" TEXT;
ALTER TABLE "deals" ADD COLUMN "outcomeNotes" TEXT;
ALTER TABLE "deals" ADD COLUMN "closedStageId" TEXT;
ALTER TABLE "deals" ADD COLUMN "closedValue" DOUBLE PRECISION;
ALTER TABLE "deals" ADD CONSTRAINT "deals_closedStageId_fkey"
    FOREIGN KEY ("closedStageId") REFERENCES "pipeline_stages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_outcomeReasonId_fkey"
    FOREIGN KEY ("outcomeReasonId") REFERENCES "deal_outcome_reasons"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Cada workspace começa com uma lista utilizável: os sete motivos de perda que
-- estavam fixos no app (sem os emoji, que não são ícone) e cinco de ganho que
-- uma clínica odontológica reconhece. São editáveis — é por isso que saíram do
-- código.
INSERT INTO "deal_outcome_reasons" ("id", "workspaceId", "kind", "name", "order")
SELECT 'seed_lost_' || w."id" || '_' || r."ord", w."id", 'lost', r."name", r."ord"
FROM "workspaces" w
CROSS JOIN (VALUES
    ('Preço alto', 1), ('Escolheu outra clínica', 2), ('Momento inadequado', 3),
    ('Sem orçamento', 4), ('Não precisa agora', 5), ('Parou de responder', 6), ('Outro', 7)
) AS r("name", "ord");

INSERT INTO "deal_outcome_reasons" ("id", "workspaceId", "kind", "name", "order")
SELECT 'seed_won_' || w."id" || '_' || r."ord", w."id", 'won', r."name", r."ord"
FROM "workspaces" w
CROSS JOIN (VALUES
    ('Indicação de paciente', 1), ('Preço e parcelamento', 2), ('Confiança no profissional', 3),
    ('Urgência do tratamento', 4), ('Outro', 5)
) AS r("name", "ord");

-- Os códigos antigos de perda saem: os negócios são de teste e carregar duas
-- fontes para o mesmo motivo é o defeito que esta mudança existe para remover.
ALTER TABLE "deals" DROP COLUMN "lossReason";
ALTER TABLE "deals" DROP COLUMN "lossNotes";
