-- O índice único de feriado deixa de ser parcial, e marcar feriado volta a
-- funcionar.
--
-- `20261014200000_agenda_specialists` criou
-- `schedule_exceptions_workspaceId_holidayKey_key` **parcial**
-- (`WHERE "holidayKey" IS NOT NULL`), por zelo: as entradas próprias da clínica
-- têm `holidayKey` nulo e não devem competir entre si.
--
-- O zelo era desnecessário e o preço foi alto. Desnecessário porque no Postgres
-- um índice único **já** trata nulos como distintos: `(ws, NULL)` nunca conflita
-- com outro `(ws, NULL)`, parcial ou não. O preço é que o schema do Prisma
-- declara um `@@unique` comum, e `prisma.upsert` compila para
-- `INSERT … ON CONFLICT ("workspaceId","holidayKey") DO UPDATE` — e o Postgres
-- **não infere índice parcial** a partir de uma lista de colunas. Toda tentativa
-- de marcar um feriado morria em:
--
--     there is no unique or exclusion constraint matching the ON CONFLICT
--     specification
--
-- que a tela mostrava como "Não foi possível salvar".
--
-- Sem risco de duplicata na troca: o índice parcial já garantia unicidade em
-- toda linha com `holidayKey` preenchido, que são exatamente as que o índice
-- novo cobre.

DROP INDEX IF EXISTS "schedule_exceptions_workspaceId_holidayKey_key";

CREATE UNIQUE INDEX "schedule_exceptions_workspaceId_holidayKey_key"
    ON "schedule_exceptions"("workspaceId", "holidayKey");
