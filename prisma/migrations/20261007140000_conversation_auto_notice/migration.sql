-- The last automatic courtesy notice sent to the patient, and why.
--
-- Keeps the "one per conversation" rule honest: a handoff notice must not repeat
-- on every message the patient sends, but a different situation later may
-- warrant a new one. See PRODUCT.md.
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "autoNoticeAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "autoNoticeKind" TEXT;
