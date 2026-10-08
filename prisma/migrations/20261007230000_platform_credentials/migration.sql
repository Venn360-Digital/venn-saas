-- The workspace that operates the product. Its OWNER administers the
-- platform-wide integration credentials.
ALTER TABLE "workspaces" ADD COLUMN "isPlatform" BOOLEAN NOT NULL DEFAULT false;

-- The oldest workspace is the operator's own: it existed before any clinic was
-- onboarded. Flagging it here rather than by hand keeps the fact in the history.
UPDATE "workspaces"
SET "isPlatform" = true
WHERE id = (SELECT id FROM "workspaces" ORDER BY "createdAt" ASC LIMIT 1);

-- Credentials of the OAuth application itself, one row per provider.
CREATE TABLE "platform_credentials" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "metadata" JSONB,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_credentials_provider_key" ON "platform_credentials"("provider");
