-- ============================================
-- FIX: Deduplicate existing conversations
-- Keep the oldest conversation per contact+workspace, merge messages
-- ============================================

-- Step 1: Move messages from duplicate conversations to the canonical (oldest) one
WITH canonical AS (
  SELECT DISTINCT ON ("contactId", "workspaceId")
    id, "contactId", "workspaceId"
  FROM conversations
  ORDER BY "contactId", "workspaceId", "createdAt" ASC
),
duplicates AS (
  SELECT c.id AS dup_id, can.id AS canonical_id
  FROM conversations c
  JOIN canonical can ON c."contactId" = can."contactId"
    AND c."workspaceId" = can."workspaceId"
    AND c.id != can.id
)
UPDATE messages
SET "conversationId" = d.canonical_id
FROM duplicates d
WHERE messages."conversationId" = d.dup_id;

-- Step 2: Move conversation tags from duplicates to canonical
WITH canonical AS (
  SELECT DISTINCT ON ("contactId", "workspaceId")
    id, "contactId", "workspaceId"
  FROM conversations
  ORDER BY "contactId", "workspaceId", "createdAt" ASC
),
duplicates AS (
  SELECT c.id AS dup_id, can.id AS canonical_id
  FROM conversations c
  JOIN canonical can ON c."contactId" = can."contactId"
    AND c."workspaceId" = can."workspaceId"
    AND c.id != can.id
)
INSERT INTO conversation_tags ("conversationId", "tagId")
SELECT d.canonical_id, ct."tagId"
FROM conversation_tags ct
JOIN duplicates d ON ct."conversationId" = d.dup_id
ON CONFLICT DO NOTHING;

-- Step 3: Delete tags from duplicate conversations
WITH canonical AS (
  SELECT DISTINCT ON ("contactId", "workspaceId")
    id, "contactId", "workspaceId"
  FROM conversations
  ORDER BY "contactId", "workspaceId", "createdAt" ASC
),
duplicates AS (
  SELECT c.id AS dup_id
  FROM conversations c
  JOIN canonical can ON c."contactId" = can."contactId"
    AND c."workspaceId" = can."workspaceId"
    AND c.id != can.id
)
DELETE FROM conversation_tags
WHERE "conversationId" IN (SELECT dup_id FROM duplicates);

-- Step 4: Delete the duplicate conversations
WITH canonical AS (
  SELECT DISTINCT ON ("contactId", "workspaceId")
    id, "contactId", "workspaceId"
  FROM conversations
  ORDER BY "contactId", "workspaceId", "createdAt" ASC
)
DELETE FROM conversations
WHERE id NOT IN (SELECT id FROM canonical)
  AND "contactId" IN (
    SELECT "contactId" FROM conversations
    GROUP BY "contactId", "workspaceId"
    HAVING COUNT(*) > 1
  );

-- Step 5: Update lastMessageAt on canonical conversations
UPDATE conversations c
SET "lastMessageAt" = sub.last_msg
FROM (
  SELECT "conversationId", MAX("createdAt") AS last_msg
  FROM messages
  GROUP BY "conversationId"
) sub
WHERE c.id = sub."conversationId";

-- ============================================
-- FIX: Deduplicate existing open deals
-- Keep the oldest open deal per contact+workspace
-- ============================================

-- Move activities from duplicate deals to the canonical one
WITH ranked AS (
  SELECT id, "contactId", "workspaceId",
    ROW_NUMBER() OVER (
      PARTITION BY "contactId", "workspaceId"
      ORDER BY "createdAt" ASC
    ) AS rn
  FROM deals
  WHERE status = 'open'
    AND "contactId" IS NOT NULL
),
canonical AS (
  SELECT id, "contactId", "workspaceId" FROM ranked WHERE rn = 1
),
dupes AS (
  SELECT r.id AS dup_id, c.id AS canonical_id
  FROM ranked r
  JOIN canonical c ON r."contactId" = c."contactId" AND r."workspaceId" = c."workspaceId"
  WHERE r.rn > 1
)
UPDATE activities
SET "dealId" = d.canonical_id
FROM dupes d
WHERE activities."dealId" = d.dup_id;

-- Delete duplicate open deals (keep the oldest one per contact)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "contactId", "workspaceId"
    ORDER BY "createdAt" ASC
  ) AS rn
  FROM deals
  WHERE status = 'open'
    AND "contactId" IS NOT NULL
)
DELETE FROM deals
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ============================================
-- Add partial unique indexes to prevent future duplicates
-- ============================================

-- Prevent multiple open deals per contact per workspace
CREATE UNIQUE INDEX IF NOT EXISTS "deals_contact_workspace_open_unique"
ON deals ("contactId", "workspaceId")
WHERE status = 'open' AND "contactId" IS NOT NULL;

-- Prevent multiple active conversations per contact per workspace
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_contact_workspace_active_unique"
ON conversations ("contactId", "workspaceId")
WHERE status != 'closed';
