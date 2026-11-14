-- One row per notification actually sent.
--
-- Without it a cron that runs twice, or catches up after being down, sends the
-- same warning again — and a billing warning that arrives three times reads as a
-- broken product at exactly the moment the clinic is deciding whether to pay.
--
-- `scope` carries whatever makes a notice repeatable: the billing period for a
-- recurring warning, empty for a once-ever one.
CREATE TABLE IF NOT EXISTS "notification_logs" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "scope"       TEXT NOT NULL DEFAULT '',
  "sentTo"      TEXT NOT NULL,
  "sentAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_logs_workspaceId_kind_scope_key"
  ON "notification_logs"("workspaceId", "kind", "scope");

CREATE INDEX IF NOT EXISTS "notification_logs_workspaceId_sentAt_idx"
  ON "notification_logs"("workspaceId", "sentAt");

ALTER TABLE "notification_logs"
  DROP CONSTRAINT IF EXISTS "notification_logs_workspaceId_fkey";
ALTER TABLE "notification_logs"
  ADD CONSTRAINT "notification_logs_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
