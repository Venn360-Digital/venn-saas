/*
  Warnings:

  - Added the required column `updatedAt` to the `products_services` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "startTime" TEXT;

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "preferences" JSONB;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "products_services" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'product',
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "group" TEXT,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "credits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentMethod" JSONB,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hashedPassword" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "address" TEXT,
ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "logo" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "quick_responses" (
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
CREATE TABLE "agent_integrations" (
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

    CONSTRAINT "agent_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_webhooks" (
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
CREATE TABLE "agent_custom_fields" (
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

-- CreateIndex
CREATE INDEX "quick_responses_workspaceId_idx" ON "quick_responses"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "quick_responses_workspaceId_command_key" ON "quick_responses"("workspaceId", "command");

-- CreateIndex
CREATE INDEX "agent_integrations_agentId_idx" ON "agent_integrations"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_integrations_agentId_channel_key" ON "agent_integrations"("agentId", "channel");

-- CreateIndex
CREATE INDEX "agent_webhooks_agentId_idx" ON "agent_webhooks"("agentId");

-- CreateIndex
CREATE INDEX "agent_custom_fields_agentId_idx" ON "agent_custom_fields"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_custom_fields_agentId_variable_key" ON "agent_custom_fields"("agentId", "variable");

-- CreateIndex
CREATE INDEX "products_services_name_idx" ON "products_services"("name");

-- CreateIndex
CREATE INDEX "products_services_sku_idx" ON "products_services"("sku");

-- AddForeignKey
ALTER TABLE "quick_responses" ADD CONSTRAINT "quick_responses_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_integrations" ADD CONSTRAINT "agent_integrations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_webhooks" ADD CONSTRAINT "agent_webhooks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_custom_fields" ADD CONSTRAINT "agent_custom_fields_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
