-- Schema (DDL, somente estrutura) do OdontoBox360 — branch production do Neon projeto odontobox (polished-shape-42069569).
-- Gerado em 2026-10-27T05:18:15Z via 'prisma migrate diff --from-empty --to-url <tmp>' no projeto temporário tmp-migration-check,
-- cuja estrutura foi provada IDÊNTICA à produção na Fase 01-E (colunas/índices/constraints por md5). Nenhum dado, nenhuma credencial.
-- Extensões em produção: pg_trgm 1.6, unaccent 1.1, vector 0.8.6, plpgsql 1.0.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cpfCnpj" TEXT,
    "logo" TEXT,
    "asaasCustomerId" TEXT,
    "billingExempt" BOOLEAN NOT NULL DEFAULT false,
    "billingStartsAt" TIMESTAMP(3),
    "postalCode" TEXT,
    "address" TEXT,
    "addressNumber" TEXT,
    "complement" TEXT,
    "province" TEXT,
    "city" TEXT,
    "state" TEXT,
    "billingPhone" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activities" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endTime" TEXT,
    "completedAt" TIMESTAMP(3),
    "reminderMinutes" INTEGER,
    "reminderSentAt" TIMESTAMP(3),
    "recurrenceType" TEXT,
    "recurrenceEnd" TIMESTAMP(3),
    "recurrenceParentId" TEXT,
    "googleCalendarEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchText" TEXT DEFAULT immutable_unaccent(lower(((title || ' '::text) || COALESCE(description, ''::text)))),
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "specialistId" TEXT,
    "productServiceId" TEXT,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_custom_fields" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "variable" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "config" JSONB,
    "defaultValue" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_integrations" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "config" JSONB,
    "connectedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "phoneNumber" TEXT,
    "label" TEXT,
    "departmentId" TEXT,
    "publicKey" TEXT,
    "defaultOriginId" TEXT,
    "defaultMediaId" TEXT,

    CONSTRAINT "agent_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_rules" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_webhooks" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authType" TEXT,
    "authConfig" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "lastTriggeredAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "events" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agents" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatar" TEXT,
    "llmProvider" TEXT NOT NULL,
    "llmModel" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "initialMessage" TEXT,
    "agentFunction" TEXT,
    "jobDescription" TEXT,
    "companyName" TEXT,
    "companySector" TEXT,
    "companyWebsite" TEXT,
    "companyDescription" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#3B82F6',
    "voiceTone" TEXT,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "voiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "voiceModel" TEXT,
    "voiceTraining" TEXT,
    "visualConfig" JSONB,
    "knowledgeBase" JSONB,
    "preferences" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pausedByLimit" BOOLEAN NOT NULL DEFAULT false,
    "companyAddress" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_secrets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."asaas_checkouts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "asaasCheckoutId" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "valueCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "kind" TEXT NOT NULL DEFAULT 'assinatura',
    "packCredits" INTEGER,
    "packPriceCents" INTEGER,
    "units" INTEGER,
    "workspaceId" TEXT,

    CONSTRAINT "asaas_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."asaas_events" (
    "id" TEXT NOT NULL,
    "asaasEventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "asaas_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "password" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."broadcast_lists" (
    "broadcastId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,

    CONSTRAINT "broadcast_lists_pkey" PRIMARY KEY ("broadcastId","listId")
);

-- CreateTable
CREATE TABLE "public"."broadcast_recipients" (
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

-- CreateTable
CREATE TABLE "public"."broadcasts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
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

-- CreateTable
CREATE TABLE "public"."contact_list_members" (
    "listId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_list_members_pkey" PRIMARY KEY ("listId","contactId")
);

-- CreateTable
CREATE TABLE "public"."contact_lists" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'static',
    "filter" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contact_tags" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "public"."contacts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "avatar" TEXT,
    "notes" TEXT,
    "customFields" JSONB,
    "createdVia" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchText" TEXT DEFAULT immutable_unaccent(lower(((((COALESCE(name, ''::text) || ' '::text) || COALESCE(email, ''::text)) || ' '::text) || COALESCE(phone, ''::text)))),
    "autoMessagesPausedAt" TIMESTAMP(3),
    "instagramId" TEXT,
    "originId" TEXT,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_tags" (
    "conversationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("conversationId","tagId")
);

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "agentId" TEXT,
    "channel" TEXT NOT NULL,
    "channelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "assignedTo" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "autoNoticeAt" TIMESTAMP(3),
    "autoNoticeKind" TEXT,
    "summaryText" TEXT,
    "summaryAt" TIMESTAMP(3),
    "summaryUntilId" TEXT,
    "integrationId" TEXT,
    "visitorKey" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."credit_purchases" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."custom_field_definitions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deal_outcome_reasons" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_outcome_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deal_stage_entries" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_stage_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "userId" TEXT,
    "originId" TEXT,
    "mediaId" TEXT,
    "title" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" TEXT NOT NULL DEFAULT 'open',
    "stageId" TEXT NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "trackingData" JSONB,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "outcomeReasonId" TEXT,
    "outcomeNotes" TEXT,
    "closedStageId" TEXT,
    "closedValue" DOUBLE PRECISION,
    "searchText" TEXT DEFAULT immutable_unaccent(lower(title)),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."departments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "searchText" TEXT DEFAULT immutable_unaccent(lower(((name || ' '::text) || COALESCE(description, ''::text)))),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."integrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "credentials" JSONB,
    "phoneNumber" TEXT,
    "qrCode" TEXT,
    "metadata" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoices" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "asaasPaymentId" TEXT NOT NULL,
    "asaasSubscriptionId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "billingType" TEXT,
    "valueCents" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "invoiceUrl" TEXT,
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventAt" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_documents" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "embedding" vector(1536),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."medias" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'text',
    "mediaUrl" TEXT,
    "replyToId" TEXT,
    "sentBy" TEXT,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transcript" TEXT,
    "reaction" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_logs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "sentTo" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."origins" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "origins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."outbox_events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_cards" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "asaasToken" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payment_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pipeline_stages" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "followUpDays" INTEGER,
    "autoSend" TEXT NOT NULL DEFAULT 'off',

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."platform_credentials" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "metadata" JSONB,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."processed_messages" (
    "chave" TEXT NOT NULL,
    "fila" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "public"."products_services" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "category" TEXT NOT NULL DEFAULT 'product',
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "group" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchText" TEXT DEFAULT immutable_unaccent(lower(((((((name || ' '::text) || COALESCE(description, ''::text)) || ' '::text) || COALESCE(sku, ''::text)) || ' '::text) || COALESCE("group", ''::text)))),
    "durationMinutes" INTEGER,

    CONSTRAINT "products_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."quick_responses" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quick_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."schedule_exceptions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "holidayKey" TEXT,
    "name" TEXT NOT NULL,
    "startsOn" DATE,
    "endsOn" DATE,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "startTime" TEXT,
    "endTime" TEXT,
    "blocks" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."specialist_window_procedures" (
    "windowId" TEXT NOT NULL,
    "productServiceId" TEXT NOT NULL,

    CONSTRAINT "specialist_window_procedures_pkey" PRIMARY KEY ("windowId","productServiceId")
);

-- CreateTable
CREATE TABLE "public"."specialist_windows" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "agentCanBook" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specialist_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."specialists" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "color" TEXT NOT NULL DEFAULT '#06B6D4',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specialists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscriptions" (
    "id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "maxAgents" INTEGER NOT NULL DEFAULT 1,
    "maxMessages" INTEGER NOT NULL DEFAULT 100,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "stripeId" TEXT,
    "paymentMethod" JSONB,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "maxWhatsAppNumbers" INTEGER NOT NULL DEFAULT 1,
    "trialStartsAt" TIMESTAMP(3),
    "readOnlySince" TIMESTAMP(3),
    "maxSpokenReplies" INTEGER NOT NULL DEFAULT 0,
    "accountId" TEXT NOT NULL,
    "asaasSubscriptionId" TEXT,
    "pastDueSince" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tags" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "searchText" TEXT DEFAULT immutable_unaccent(lower(name)),

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."terms_acceptances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."unit_addons" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceledAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "unit_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."usage_logs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "hashedPassword" TEXT,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchText" TEXT DEFAULT immutable_unaccent(lower(((((COALESCE(name, ''::text) || ' '::text) || COALESCE("lastName", ''::text)) || ' '::text) || email))),
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."whatsapp_templates" (
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

-- CreateTable
CREATE TABLE "public"."workspace_user_departments" (
    "workspaceUserId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "workspace_user_departments_pkey" PRIMARY KEY ("workspaceUserId","departmentId")
);

-- CreateTable
CREATE TABLE "public"."workspace_users" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "canTransfer" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "permissions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "avatar" TEXT,
    "settings" JSONB,
    "cnpj" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isPlatform" BOOLEAN NOT NULL DEFAULT false,
    "automations" JSONB,
    "accountId" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_asaasCustomerId_key" ON "public"."accounts"("asaasCustomerId" ASC);

-- CreateIndex
CREATE INDEX "accounts_ownerUserId_idx" ON "public"."accounts"("ownerUserId" ASC);

-- CreateIndex
CREATE INDEX "activities_dueDate_idx" ON "public"."activities"("dueDate" ASC);

-- CreateIndex
CREATE INDEX "activities_recurrenceParentId_idx" ON "public"."activities"("recurrenceParentId" ASC);

-- CreateIndex
CREATE INDEX "activities_searchText_trgm" ON "public"."activities" USING GIN ("searchText" gin_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "activities_specialistId_idx" ON "public"."activities"("specialistId" ASC);

-- CreateIndex
CREATE INDEX "activities_userId_idx" ON "public"."activities"("userId" ASC);

-- CreateIndex
CREATE INDEX "activities_workspaceId_idx" ON "public"."activities"("workspaceId" ASC);

-- CreateIndex
CREATE INDEX "agent_custom_fields_agentId_idx" ON "public"."agent_custom_fields"("agentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "agent_custom_fields_agentId_variable_key" ON "public"."agent_custom_fields"("agentId" ASC, "variable" ASC);

-- CreateIndex
CREATE INDEX "agent_integrations_agentId_channel_idx" ON "public"."agent_integrations"("agentId" ASC, "channel" ASC);

-- CreateIndex
CREATE INDEX "agent_integrations_agentId_idx" ON "public"."agent_integrations"("agentId" ASC);

-- CreateIndex
CREATE INDEX "agent_integrations_defaultMediaId_idx" ON "public"."agent_integrations"("defaultMediaId" ASC);

-- CreateIndex
CREATE INDEX "agent_integrations_defaultOriginId_idx" ON "public"."agent_integrations"("defaultOriginId" ASC);

-- CreateIndex
CREATE INDEX "agent_integrations_departmentId_idx" ON "public"."agent_integrations"("departmentId" ASC);

-- CreateIndex
CREATE INDEX "agent_integrations_publicKey_idx" ON "public"."agent_integrations"("publicKey" ASC);

-- CreateIndex
CREATE INDEX "agent_rules_agentId_idx" ON "public"."agent_rules"("agentId" ASC);

-- CreateIndex
CREATE INDEX "agent_webhooks_agentId_idx" ON "public"."agent_webhooks"("agentId" ASC);

-- CreateIndex
CREATE INDEX "agents_workspaceId_idx" ON "public"."agents"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "app_secrets_name_key" ON "public"."app_secrets"("name" ASC);

-- CreateIndex
CREATE INDEX "asaas_checkouts_accountId_createdAt_idx" ON "public"."asaas_checkouts"("accountId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "asaas_checkouts_asaasCheckoutId_key" ON "public"."asaas_checkouts"("asaasCheckoutId" ASC);

-- CreateIndex
CREATE INDEX "asaas_checkouts_status_idx" ON "public"."asaas_checkouts"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "asaas_events_asaasEventId_key" ON "public"."asaas_events"("asaasEventId" ASC);

-- CreateIndex
CREATE INDEX "asaas_events_event_receivedAt_idx" ON "public"."asaas_events"("event" ASC, "receivedAt" ASC);

-- CreateIndex
CREATE INDEX "asaas_events_processedAt_idx" ON "public"."asaas_events"("processedAt" ASC);

-- CreateIndex
CREATE INDEX "auth_accounts_providerId_accountId_idx" ON "public"."auth_accounts"("providerId" ASC, "accountId" ASC);

-- CreateIndex
CREATE INDEX "auth_accounts_userId_idx" ON "public"."auth_accounts"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "public"."auth_rate_limits"("key" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_key" ON "public"."auth_sessions"("token" ASC);

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "public"."auth_sessions"("userId" ASC);

-- CreateIndex
CREATE INDEX "auth_verifications_identifier_idx" ON "public"."auth_verifications"("identifier" ASC);

-- CreateIndex
CREATE INDEX "broadcast_lists_listId_idx" ON "public"."broadcast_lists"("listId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_broadcastId_contactId_key" ON "public"."broadcast_recipients"("broadcastId" ASC, "contactId" ASC);

-- CreateIndex
CREATE INDEX "broadcast_recipients_broadcastId_status_idx" ON "public"."broadcast_recipients"("broadcastId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "broadcasts_status_scheduledAt_idx" ON "public"."broadcasts"("status" ASC, "scheduledAt" ASC);

-- CreateIndex
CREATE INDEX "broadcasts_workspaceId_status_idx" ON "public"."broadcasts"("workspaceId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "contact_list_members_contactId_idx" ON "public"."contact_list_members"("contactId" ASC);

-- CreateIndex
CREATE INDEX "contact_lists_workspaceId_idx" ON "public"."contact_lists"("workspaceId" ASC);

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "public"."contacts"("email" ASC);

-- CreateIndex
CREATE INDEX "contacts_instagramId_idx" ON "public"."contacts"("instagramId" ASC);

-- CreateIndex
CREATE INDEX "contacts_originId_idx" ON "public"."contacts"("originId" ASC);

-- CreateIndex
CREATE INDEX "contacts_phone_idx" ON "public"."contacts"("phone" ASC);

-- CreateIndex
CREATE INDEX "contacts_searchText_trgm" ON "public"."contacts" USING GIN ("searchText" gin_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "contacts_workspaceId_idx" ON "public"."contacts"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_workspaceId_instagramId_key" ON "public"."contacts"("workspaceId" ASC, "instagramId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_workspaceId_phone_key" ON "public"."contacts"("workspaceId" ASC, "phone" ASC);

-- CreateIndex
CREATE INDEX "conversations_assignedTo_idx" ON "public"."conversations"("assignedTo" ASC);

-- CreateIndex
CREATE INDEX "conversations_contactId_idx" ON "public"."conversations"("contactId" ASC);

-- CreateIndex
CREATE INDEX "conversations_integrationId_idx" ON "public"."conversations"("integrationId" ASC);

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "public"."conversations"("status" ASC);

-- CreateIndex
CREATE INDEX "conversations_visitorKey_idx" ON "public"."conversations"("visitorKey" ASC);

-- CreateIndex
CREATE INDEX "conversations_workspaceId_idx" ON "public"."conversations"("workspaceId" ASC);

-- CreateIndex
CREATE INDEX "credit_purchases_workspaceId_expiresAt_idx" ON "public"."credit_purchases"("workspaceId" ASC, "expiresAt" ASC);

-- CreateIndex
CREATE INDEX "custom_field_definitions_workspaceId_idx" ON "public"."custom_field_definitions"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_workspaceId_key_key" ON "public"."custom_field_definitions"("workspaceId" ASC, "key" ASC);

-- CreateIndex
CREATE INDEX "deal_outcome_reasons_workspaceId_kind_order_idx" ON "public"."deal_outcome_reasons"("workspaceId" ASC, "kind" ASC, "order" ASC);

-- CreateIndex
CREATE INDEX "deal_stage_entries_dealId_enteredAt_idx" ON "public"."deal_stage_entries"("dealId" ASC, "enteredAt" ASC);

-- CreateIndex
CREATE INDEX "deal_stage_entries_stageId_idx" ON "public"."deal_stage_entries"("stageId" ASC);

-- CreateIndex
CREATE INDEX "deals_contactId_status_idx" ON "public"."deals"("contactId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "deals_mediaId_idx" ON "public"."deals"("mediaId" ASC);

-- CreateIndex
CREATE INDEX "deals_originId_idx" ON "public"."deals"("originId" ASC);

-- CreateIndex
CREATE INDEX "deals_searchText_trgm" ON "public"."deals" USING GIN ("searchText" gin_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "deals_stageId_idx" ON "public"."deals"("stageId" ASC);

-- CreateIndex
CREATE INDEX "deals_status_idx" ON "public"."deals"("status" ASC);

-- CreateIndex
CREATE INDEX "deals_userId_idx" ON "public"."deals"("userId" ASC);

-- CreateIndex
CREATE INDEX "deals_workspaceId_idx" ON "public"."deals"("workspaceId" ASC);

-- CreateIndex
CREATE INDEX "deals_workspace_status_stage_idx" ON "public"."deals"("workspaceId" ASC, "status" ASC, "stageId" ASC);

-- CreateIndex
CREATE INDEX "departments_workspaceId_idx" ON "public"."departments"("workspaceId" ASC);

-- CreateIndex
CREATE INDEX "integrations_provider_idx" ON "public"."integrations"("provider" ASC);

-- CreateIndex
CREATE INDEX "integrations_workspaceId_idx" ON "public"."integrations"("workspaceId" ASC);

-- CreateIndex
CREATE INDEX "invoices_accountId_dueDate_idx" ON "public"."invoices"("accountId" ASC, "dueDate" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_asaasPaymentId_key" ON "public"."invoices"("asaasPaymentId" ASC);

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "public"."invoices"("status" ASC);

-- CreateIndex
CREATE INDEX "knowledge_documents_agentId_idx" ON "public"."knowledge_documents"("agentId" ASC);

-- CreateIndex
CREATE INDEX "medias_workspaceId_idx" ON "public"."medias"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "medias_workspaceId_name_key" ON "public"."medias"("workspaceId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "public"."messages"("conversationId" ASC);

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "public"."messages"("createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_workspaceId_kind_scope_key" ON "public"."notification_logs"("workspaceId" ASC, "kind" ASC, "scope" ASC);

-- CreateIndex
CREATE INDEX "notification_logs_workspaceId_sentAt_idx" ON "public"."notification_logs"("workspaceId" ASC, "sentAt" ASC);

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "public"."notifications"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "notifications_workspaceId_userId_readAt_idx" ON "public"."notifications"("workspaceId" ASC, "userId" ASC, "readAt" ASC);

-- CreateIndex
CREATE INDEX "origins_workspaceId_idx" ON "public"."origins"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "origins_workspaceId_name_key" ON "public"."origins"("workspaceId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "outbox_events_createdAt_idx" ON "public"."outbox_events"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "outbox_events_workspaceId_createdAt_idx" ON "public"."outbox_events"("workspaceId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "payment_cards_accountId_idx" ON "public"."payment_cards"("accountId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "payment_cards_asaasToken_key" ON "public"."payment_cards"("asaasToken" ASC);

-- CreateIndex
CREATE INDEX "pipeline_stages_workspaceId_idx" ON "public"."pipeline_stages"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "platform_credentials_provider_key" ON "public"."platform_credentials"("provider" ASC);

-- CreateIndex
CREATE INDEX "processed_messages_expiraEm_idx" ON "public"."processed_messages"("expiraEm" ASC);

-- CreateIndex
CREATE INDEX "products_services_name_idx" ON "public"."products_services"("name" ASC);

-- CreateIndex
CREATE INDEX "products_services_sku_idx" ON "public"."products_services"("sku" ASC);

-- CreateIndex
CREATE INDEX "products_services_workspaceId_idx" ON "public"."products_services"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "quick_responses_workspaceId_command_key" ON "public"."quick_responses"("workspaceId" ASC, "command" ASC);

-- CreateIndex
CREATE INDEX "quick_responses_workspaceId_idx" ON "public"."quick_responses"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "schedule_exceptions_workspaceId_holidayKey_key" ON "public"."schedule_exceptions"("workspaceId" ASC, "holidayKey" ASC);

-- CreateIndex
CREATE INDEX "schedule_exceptions_workspaceId_idx" ON "public"."schedule_exceptions"("workspaceId" ASC);

-- CreateIndex
CREATE INDEX "specialist_window_procedures_productServiceId_idx" ON "public"."specialist_window_procedures"("productServiceId" ASC);

-- CreateIndex
CREATE INDEX "specialist_windows_specialistId_idx" ON "public"."specialist_windows"("specialistId" ASC);

-- CreateIndex
CREATE INDEX "specialists_workspaceId_idx" ON "public"."specialists"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_accountId_key" ON "public"."subscriptions"("accountId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_asaasSubscriptionId_key" ON "public"."subscriptions"("asaasSubscriptionId" ASC);

-- CreateIndex
CREATE INDEX "subscriptions_graceEndsAt_idx" ON "public"."subscriptions"("graceEndsAt" ASC);

-- CreateIndex
CREATE INDEX "tags_workspaceId_idx" ON "public"."tags"("workspaceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "terms_acceptances_userId_workspaceId_version_key" ON "public"."terms_acceptances"("userId" ASC, "workspaceId" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "unit_addons_accountId_endsAt_idx" ON "public"."unit_addons"("accountId" ASC, "endsAt" ASC);

-- CreateIndex
CREATE INDEX "unit_addons_accountId_idx" ON "public"."unit_addons"("accountId" ASC);

-- CreateIndex
CREATE INDEX "usage_logs_agentId_idx" ON "public"."usage_logs"("agentId" ASC);

-- CreateIndex
CREATE INDEX "usage_logs_workspaceId_createdAt_idx" ON "public"."usage_logs"("workspaceId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_integrationId_metaName_language_key" ON "public"."whatsapp_templates"("integrationId" ASC, "metaName" ASC, "language" ASC);

-- CreateIndex
CREATE INDEX "whatsapp_templates_workspaceId_idx" ON "public"."whatsapp_templates"("workspaceId" ASC);

-- CreateIndex
CREATE INDEX "workspace_user_departments_departmentId_idx" ON "public"."workspace_user_departments"("departmentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_users_workspaceId_userId_key" ON "public"."workspace_users"("workspaceId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "workspaces_accountId_idx" ON "public"."workspaces"("accountId" ASC);

-- CreateIndex
CREATE INDEX "workspaces_accountId_suspendedAt_idx" ON "public"."workspaces"("accountId" ASC, "suspendedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "public"."workspaces"("slug" ASC);

-- AddForeignKey
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "public"."deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_productServiceId_fkey" FOREIGN KEY ("productServiceId") REFERENCES "public"."products_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_recurrenceParentId_fkey" FOREIGN KEY ("recurrenceParentId") REFERENCES "public"."activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "public"."specialists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_custom_fields" ADD CONSTRAINT "agent_custom_fields_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_integrations" ADD CONSTRAINT "agent_integrations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_integrations" ADD CONSTRAINT "agent_integrations_defaultMediaId_fkey" FOREIGN KEY ("defaultMediaId") REFERENCES "public"."medias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_integrations" ADD CONSTRAINT "agent_integrations_defaultOriginId_fkey" FOREIGN KEY ("defaultOriginId") REFERENCES "public"."origins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_integrations" ADD CONSTRAINT "agent_integrations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_rules" ADD CONSTRAINT "agent_rules_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_webhooks" ADD CONSTRAINT "agent_webhooks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agents" ADD CONSTRAINT "agents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."asaas_checkouts" ADD CONSTRAINT "asaas_checkouts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."auth_accounts" ADD CONSTRAINT "auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcast_lists" ADD CONSTRAINT "broadcast_lists_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "public"."broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcast_lists" ADD CONSTRAINT "broadcast_lists_listId_fkey" FOREIGN KEY ("listId") REFERENCES "public"."contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "public"."broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcasts" ADD CONSTRAINT "broadcasts_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "public"."agent_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcasts" ADD CONSTRAINT "broadcasts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."whatsapp_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcasts" ADD CONSTRAINT "broadcasts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_list_members" ADD CONSTRAINT "contact_list_members_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_list_members" ADD CONSTRAINT "contact_list_members_listId_fkey" FOREIGN KEY ("listId") REFERENCES "public"."contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_lists" ADD CONSTRAINT "contact_lists_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_tags" ADD CONSTRAINT "contact_tags_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_tags" ADD CONSTRAINT "contact_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "public"."tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_originId_fkey" FOREIGN KEY ("originId") REFERENCES "public"."origins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_tags" ADD CONSTRAINT "conversation_tags_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_tags" ADD CONSTRAINT "conversation_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "public"."tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "public"."agent_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."credit_purchases" ADD CONSTRAINT "credit_purchases_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deal_outcome_reasons" ADD CONSTRAINT "deal_outcome_reasons_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deal_stage_entries" ADD CONSTRAINT "deal_stage_entries_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "public"."deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deal_stage_entries" ADD CONSTRAINT "deal_stage_entries_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_closedStageId_fkey" FOREIGN KEY ("closedStageId") REFERENCES "public"."pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "public"."medias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_originId_fkey" FOREIGN KEY ("originId") REFERENCES "public"."origins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_outcomeReasonId_fkey" FOREIGN KEY ("outcomeReasonId") REFERENCES "public"."deal_outcome_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deals" ADD CONSTRAINT "deals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."departments" ADD CONSTRAINT "departments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."integrations" ADD CONSTRAINT "integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoices" ADD CONSTRAINT "invoices_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."knowledge_documents" ADD CONSTRAINT "knowledge_documents_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."medias" ADD CONSTRAINT "medias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "public"."messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_logs" ADD CONSTRAINT "notification_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."origins" ADD CONSTRAINT "origins_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_cards" ADD CONSTRAINT "payment_cards_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."products_services" ADD CONSTRAINT "products_services_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quick_responses" ADD CONSTRAINT "quick_responses_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."specialist_window_procedures" ADD CONSTRAINT "specialist_window_procedures_productServiceId_fkey" FOREIGN KEY ("productServiceId") REFERENCES "public"."products_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."specialist_window_procedures" ADD CONSTRAINT "specialist_window_procedures_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "public"."specialist_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."specialist_windows" ADD CONSTRAINT "specialist_windows_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "public"."specialists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."specialists" ADD CONSTRAINT "specialists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."specialists" ADD CONSTRAINT "specialists_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tags" ADD CONSTRAINT "tags_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."terms_acceptances" ADD CONSTRAINT "terms_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."terms_acceptances" ADD CONSTRAINT "terms_acceptances_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."unit_addons" ADD CONSTRAINT "unit_addons_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_logs" ADD CONSTRAINT "usage_logs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_logs" ADD CONSTRAINT "usage_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "public"."agent_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workspace_user_departments" ADD CONSTRAINT "workspace_user_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workspace_user_departments" ADD CONSTRAINT "workspace_user_departments_workspaceUserId_fkey" FOREIGN KEY ("workspaceUserId") REFERENCES "public"."workspace_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workspace_users" ADD CONSTRAINT "workspace_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workspace_users" ADD CONSTRAINT "workspace_users_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workspaces" ADD CONSTRAINT "workspaces_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

