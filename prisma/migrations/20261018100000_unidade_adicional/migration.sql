-- A unidade comprada fora do que o plano inclui.
--
-- Uma linha por unidade adquirida. O teto da conta é "o que o plano inclui +
-- quantas linhas destas existem", derivado na leitura — sem contador para
-- divergir das compras, do mesmo jeito que o saldo de crédito sai de
-- `credit_purchases`.
--
-- Idempotente como todas: a migração roda no deploy, contra um banco que já
-- pode tê-la recebido.

CREATE TABLE IF NOT EXISTS "unit_addons" (
    "id"         TEXT NOT NULL,
    "accountId"  TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_addons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "unit_addons_accountId_idx" ON "unit_addons"("accountId");

-- `ON DELETE CASCADE`: fechada a conta, a compra da unidade não quer dizer
-- nada. O guarda é para o caso de a tabela já existir com a chave.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unit_addons_accountId_fkey'
    ) THEN
        ALTER TABLE "unit_addons"
            ADD CONSTRAINT "unit_addons_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
