-- Marketing / Broadcast (B2). Disparo em massa pelo WhatsApp oficial.
-- Sem políticas RLS: o controle saiu com o Supabase e virou no-op condicional
-- de propósito (ver docs do projeto); o escopo é feito na aplicação por workspace.

-- Listas de contatos: entidade de primeira classe à qual a campanha se associa.
CREATE TABLE "contact_lists" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'static',
    "filter" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_lists_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "contact_lists_workspaceId_idx" ON "contact_lists"("workspaceId");
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Membros congelados de uma lista estática.
CREATE TABLE "contact_list_members" (
    "listId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_list_members_pkey" PRIMARY KEY ("listId", "contactId")
);
CREATE INDEX "contact_list_members_contactId_idx" ON "contact_list_members"("contactId");
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Espelho local de um template de mensagem aprovado na Meta (HSM).
CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "metaName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_templates_integrationId_metaName_language_key"
    ON "whatsapp_templates"("integrationId", "metaName", "language");
CREATE INDEX "whatsapp_templates_workspaceId_idx" ON "whatsapp_templates"("workspaceId");
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_integrationId_fkey"
    FOREIGN KEY ("integrationId") REFERENCES "agent_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Campanha de disparo em massa.
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "integrationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "variables" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "throttlePerMin" INTEGER NOT NULL DEFAULT 30,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "broadcasts_workspaceId_status_idx" ON "broadcasts"("workspaceId", "status");
CREATE INDEX "broadcasts_status_scheduledAt_idx" ON "broadcasts"("status", "scheduledAt");
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_integrationId_fkey"
    FOREIGN KEY ("integrationId") REFERENCES "agent_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "whatsapp_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Um destinatário de uma campanha, com estado de entrega por contato.
CREATE TABLE "broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "messageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "broadcast_recipients_broadcastId_contactId_key"
    ON "broadcast_recipients"("broadcastId", "contactId");
CREATE INDEX "broadcast_recipients_broadcastId_status_idx"
    ON "broadcast_recipients"("broadcastId", "status");
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcastId_fkey"
    FOREIGN KEY ("broadcastId") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Vínculo campanha ↔ lista (a escolha feita no rascunho).
CREATE TABLE "broadcast_lists" (
    "broadcastId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    CONSTRAINT "broadcast_lists_pkey" PRIMARY KEY ("broadcastId", "listId")
);
CREATE INDEX "broadcast_lists_listId_idx" ON "broadcast_lists"("listId");
ALTER TABLE "broadcast_lists" ADD CONSTRAINT "broadcast_lists_broadcastId_fkey"
    FOREIGN KEY ("broadcastId") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "broadcast_lists" ADD CONSTRAINT "broadcast_lists_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
