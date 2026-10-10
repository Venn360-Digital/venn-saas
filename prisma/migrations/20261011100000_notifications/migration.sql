-- Avisos que esperam ser vistos.
--
-- O lembrete de atividade só alcançava quem estivesse com a aba aberta no
-- minuto exato. Guardado, ele sobrevive ao navegador fechado — que é a
-- diferença entre "notifiquei" e "a pessoa soube".
CREATE TABLE "notifications" (
    "id"          TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId"      TEXT,
    "kind"        TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "body"        TEXT,
    "link"        TEXT,
    "readAt"      TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_workspaceId_userId_readAt_idx"
    ON "notifications" ("workspaceId", "userId", "readAt");
CREATE INDEX "notifications_createdAt_idx" ON "notifications" ("createdAt");

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O que a clínica deixou ligado. JSON porque a lista cresce a cada camada, e
-- uma coluna por chave viraria uma migração por melhoria.
ALTER TABLE "workspaces" ADD COLUMN "automations" JSONB;
