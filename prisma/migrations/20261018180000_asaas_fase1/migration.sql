-- Fase 1 do gateway Asaas: ponteiros, log de evento e espelho de fatura.
--
-- Nada aqui cobra nada. É o alicerce: a conta ganha o cliente do Asaas, a
-- assinatura ganha a assinatura recorrente de lá, e duas tabelas novas guardam o
-- que chega pelo webhook e o que foi cobrado.
--
-- Idempotente como todas: roda no deploy, contra um banco que já pode tê-la
-- recebido.

-- 1. O campo de documento passa a aceitar CPF.
--
-- Decisão do Andre em 2026-10-18: dentista sozinho às vezes não tem CNPJ, e o
-- Asaas recebe os dois no mesmo campo (`cpfCnpj`). O nome `cnpj` mentiria sobre
-- o que cabe. Guardado porque renomear duas vezes é pior que o `IF EXISTS`.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'accounts' AND column_name = 'cnpj'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'accounts' AND column_name = 'cpfCnpj'
    ) THEN
        ALTER TABLE "accounts" RENAME COLUMN "cnpj" TO "cpfCnpj";
    END IF;
END $$;

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "cpfCnpj" TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "asaasCustomerId" TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "billingExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "billingStartsAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "accounts_asaasCustomerId_key" ON "accounts"("asaasCustomerId");

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "asaasSubscriptionId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_asaasSubscriptionId_key"
    ON "subscriptions"("asaasSubscriptionId");

-- 2. O log de evento. `asaasEventId` único é a trava de idempotência: a entrega
--    do Asaas é at-least-once, e processar duas vezes dobraria crédito.
CREATE TABLE IF NOT EXISTS "asaas_events" (
    "id"           TEXT NOT NULL,
    "asaasEventId" TEXT NOT NULL,
    "event"        TEXT NOT NULL,
    "payload"      JSONB NOT NULL,
    "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt"  TIMESTAMP(3),
    "error"        TEXT,
    "attempts"     INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "asaas_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "asaas_events_asaasEventId_key" ON "asaas_events"("asaasEventId");
CREATE INDEX IF NOT EXISTS "asaas_events_event_receivedAt_idx" ON "asaas_events"("event", "receivedAt");
CREATE INDEX IF NOT EXISTS "asaas_events_processedAt_idx" ON "asaas_events"("processedAt");

-- 3. O espelho das cobranças. Não é livro-caixa: existe para a tela não
--    chamar a API a cada abertura, e para a conciliação ter o que comparar.
CREATE TABLE IF NOT EXISTS "invoices" (
    "id"                  TEXT NOT NULL,
    "accountId"           TEXT NOT NULL,
    "asaasPaymentId"      TEXT NOT NULL,
    "asaasSubscriptionId" TEXT,
    "kind"                TEXT NOT NULL,
    "status"              TEXT NOT NULL,
    "billingType"         TEXT,
    "valueCents"          INTEGER NOT NULL,
    "dueDate"             TIMESTAMP(3) NOT NULL,
    "paidAt"              TIMESTAMP(3),
    "invoiceUrl"          TEXT,
    "receiptUrl"          TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_asaasPaymentId_key" ON "invoices"("asaasPaymentId");
CREATE INDEX IF NOT EXISTS "invoices_accountId_dueDate_idx" ON "invoices"("accountId", "dueDate");
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices"("status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_accountId_fkey') THEN
        ALTER TABLE "invoices"
            ADD CONSTRAINT "invoices_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. As duas contas que já existem, pelas decisões do Andre de 2026-10-18.
--
-- Por **nome** e não por id: os ids são gerados e seriam diferentes em qualquer
-- outro banco. `WHERE` casando nada é um no-op, que é o certo num banco onde
-- estas contas não existem.
UPDATE "accounts" SET "billingExempt" = true WHERE "name" = 'Venn360';

-- A Implante Ja usa de graça desde antes da cobrança existir e passa a ser
-- cobrada em 27/10/2026. Só grava se ainda estiver nulo, para não reescrever
-- uma data que alguém já ajustou pela tela.
UPDATE "accounts"
   SET "billingStartsAt" = TIMESTAMP '2026-10-27 00:00:00'
 WHERE "name" = 'Implante Ja' AND "billingStartsAt" IS NULL;
