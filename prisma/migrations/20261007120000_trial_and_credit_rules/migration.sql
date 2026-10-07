-- Trial, credit and plan-limit rules. See PRODUCT.md.

-- The trial is anchored to the owner's signup, not to the end of onboarding, and
-- readOnlySince starts the retention clock once it lapses without a plan.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "trialStartsAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "readOnlySince" TIMESTAMP(3);

-- An agent pushed past the plan's allowance by a downgrade. The user cannot
-- switch it back on; only a plan that fits releases it.
ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "pausedByLimit" BOOLEAN NOT NULL DEFAULT false;

-- The connected number, lifted out of the config JSON so it can be constrained:
-- a number belongs to one workspace at a time, which is what stops trials being
-- chained with the same line.
ALTER TABLE "agent_integrations"
  ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_integrations_phoneNumber_key"
  ON "agent_integrations"("phoneNumber")
  WHERE "phoneNumber" IS NOT NULL;

-- Avulso credits. Separate from the plan's allowance because the two expire
-- differently: plan credits are discarded at renewal, these last 90 days from
-- purchase or until spent.
CREATE TABLE IF NOT EXISTS "credit_purchases" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "amount"      INTEGER NOT NULL,
  "used"        INTEGER NOT NULL DEFAULT 0,
  "priceCents"  INTEGER NOT NULL DEFAULT 0,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_purchases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "credit_purchases_workspaceId_expiresAt_idx"
  ON "credit_purchases"("workspaceId", "expiresAt");

ALTER TABLE "credit_purchases"
  DROP CONSTRAINT IF EXISTS "credit_purchases_workspaceId_fkey";
ALTER TABLE "credit_purchases"
  ADD CONSTRAINT "credit_purchases_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Who accepted which version of the terms, and when.
CREATE TABLE IF NOT EXISTS "terms_acceptances" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "version"     TEXT NOT NULL,
  "acceptedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "terms_acceptances_userId_workspaceId_version_key"
  ON "terms_acceptances"("userId", "workspaceId", "version");

ALTER TABLE "terms_acceptances"
  DROP CONSTRAINT IF EXISTS "terms_acceptances_userId_fkey";
ALTER TABLE "terms_acceptances"
  ADD CONSTRAINT "terms_acceptances_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "terms_acceptances"
  DROP CONSTRAINT IF EXISTS "terms_acceptances_workspaceId_fkey";
ALTER TABLE "terms_acceptances"
  ADD CONSTRAINT "terms_acceptances_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
