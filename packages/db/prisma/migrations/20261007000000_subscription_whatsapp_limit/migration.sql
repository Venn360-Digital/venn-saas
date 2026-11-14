-- How many WhatsApp numbers a plan allows to be connected at once.
--
-- The column is enforced at connection time, not just displayed: without it the
-- plan a clinic pays for had no bearing on what the workspace could actually do.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "maxWhatsAppNumbers" INTEGER NOT NULL DEFAULT 1;
