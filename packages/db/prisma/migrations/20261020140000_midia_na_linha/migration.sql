-- A linha passa a semear **mídia**, além de origem.
--
-- Decisão do Andre em 2026-10-20, e ela fecha o par: a linha já dizia *quem*
-- trouxe o paciente (`defaultOriginId` — a agência, o indicador), e agora diz
-- também *o quê* o trouxe (a campanha, a peça). Cadastrar a linha uma vez
-- passa a preencher os dois campos em toda ficha que nasce por ali.
--
-- Origem e mídia continuam sendo coisas diferentes: origem é de quem veio o
-- lead, mídia é o detalhe dentro dela. Ver PRODUCT.md §10.
ALTER TABLE "agent_integrations"
    ADD COLUMN IF NOT EXISTS "defaultMediaId" TEXT;

CREATE INDEX IF NOT EXISTS "agent_integrations_defaultMediaId_idx"
    ON "agent_integrations" ("defaultMediaId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_integrations_defaultMediaId_fkey'
    ) THEN
        ALTER TABLE "agent_integrations"
            ADD CONSTRAINT "agent_integrations_defaultMediaId_fkey"
            FOREIGN KEY ("defaultMediaId") REFERENCES "medias"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
