-- A tentativa de contratar: o checkout criado, esperando pagamento.
--
-- Contratar deixou de ser instantâneo. Entre clicar e o plano valer há um
-- redirecionamento, um Pix ou cartão, e um webhook — e nesse intervalo a tela
-- precisa dizer "esperando confirmação" em vez de "sem plano".
--
-- O id desta linha vai no `externalReference` do checkout: é por ele que o
-- webhook sabe qual conta e qual plano foram pagos. Sem isso, cada pagamento
-- que volta é um pagamento órfão para conciliar à mão.

CREATE TABLE IF NOT EXISTS "asaas_checkouts" (
    "id"              TEXT NOT NULL,
    "accountId"       TEXT NOT NULL,
    "plan"            TEXT NOT NULL,
    "asaasCheckoutId" TEXT NOT NULL,
    "link"            TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
    "valueCents"      INTEGER NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt"          TIMESTAMP(3),

    CONSTRAINT "asaas_checkouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "asaas_checkouts_asaasCheckoutId_key"
    ON "asaas_checkouts"("asaasCheckoutId");
CREATE INDEX IF NOT EXISTS "asaas_checkouts_accountId_createdAt_idx"
    ON "asaas_checkouts"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "asaas_checkouts_status_idx" ON "asaas_checkouts"("status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_checkouts_accountId_fkey') THEN
        ALTER TABLE "asaas_checkouts"
            ADD CONSTRAINT "asaas_checkouts_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
