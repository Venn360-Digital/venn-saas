-- A assinatura sobe do workspace para a conta.
--
-- O Multiclínica passa a incluir até três unidades, e "o plano inclui 3" não
-- tem onde morar enquanto a assinatura for de um workspace. Nasce a conta: o
-- cliente, acima das clínicas dele.
--
-- **Esta migração não muda comportamento nenhum.** Ela cria uma conta por
-- workspace existente e move a assinatura para lá. Depois dela, cada conta tem
-- exatamente uma unidade — igual a hoje. O que ela cria é o lugar onde o
-- segundo workspace vai caber.
--
-- A alternativa descartada em 2026-10-18 era manter assinatura por workspace.
-- Ela custaria meio dia a menos agora e, depois, três datas de renovação para o
-- mesmo dono, três cartões, créditos que não se somam entre unidades e —
-- o pior — cancelar uma sem cancelar as outras, com o cliente achando que
-- cancelou tudo.

CREATE TABLE IF NOT EXISTS "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "accounts_ownerUserId_idx" ON "accounts"("ownerUserId");

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "accountId" TEXT;

-- (1) Uma conta por workspace, com o nome da unidade e o dono dela.
--
-- O id é determinístico, no padrão `seed_` das outras migrações: rodar duas
-- vezes não duplica. O MASTER sai do membro com papel OWNER — o mais antigo,
-- quando há mais de um, que é o critério já usado em todo lugar para desempatar
-- participação.
INSERT INTO "accounts" ("id", "name", "ownerUserId", "createdAt", "updatedAt")
SELECT
    'seed_account_' || w."id",
    w."name",
    (
        SELECT wu."userId"
        FROM "workspace_users" wu
        WHERE wu."workspaceId" = w."id" AND wu."role" = 'OWNER'
        ORDER BY wu."createdAt" ASC
        LIMIT 1
    ),
    w."createdAt",
    now()
FROM "workspaces" w
ON CONFLICT DO NOTHING;

UPDATE "workspaces" w
SET "accountId" = 'seed_account_' || w."id"
WHERE w."accountId" IS NULL;

-- Toda unidade tem conta: a coluna fecha.
ALTER TABLE "workspaces" ALTER COLUMN "accountId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "workspaces_accountId_idx" ON "workspaces"("accountId");

-- (2) A assinatura troca de dono.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "accountId" TEXT;

UPDATE "subscriptions" s
SET "accountId" = w."accountId"
FROM "workspaces" w
WHERE w."id" = s."workspaceId"
  AND s."accountId" IS NULL;

-- Assinatura órfã não deveria existir — o `workspaceId` era NOT NULL com chave
-- estrangeira. Se existir, a migração para aqui em vez de criar linha solta.
ALTER TABLE "subscriptions" ALTER COLUMN "accountId" SET NOT NULL;

DROP INDEX IF EXISTS "subscriptions_workspaceId_key";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "workspaceId";

CREATE UNIQUE INDEX "subscriptions_accountId_key" ON "subscriptions"("accountId");

-- (3) As chaves estrangeiras.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_ownerUserId_fkey') THEN
    ALTER TABLE "accounts"
      ADD CONSTRAINT "accounts_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_accountId_fkey') THEN
    ALTER TABLE "workspaces"
      ADD CONSTRAINT "workspaces_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_accountId_fkey') THEN
    ALTER TABLE "subscriptions"
      ADD CONSTRAINT "subscriptions_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
