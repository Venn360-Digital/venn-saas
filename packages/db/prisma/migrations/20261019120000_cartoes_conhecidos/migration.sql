-- Os cartões que já pagaram alguma coisa desta conta.
--
-- Existe para que trocar o cartão da assinatura **não exija o número do
-- cartão**. Medido contra o sandbox em 2026-10-19:
-- `PUT /v3/subscriptions/{id}/creditCard` aceita ou o cartão inteiro — que
-- levaria o PAN para dentro da nossa aplicação e dos nossos logs — ou um
-- `creditCardToken` que já exista no Asaas.
--
-- O token nasce quando alguém paga com aquele cartão na página deles, e volta
-- para nós dentro do evento de pagamento. Guardá-lo (com bandeira e quatro
-- dígitos finais, que é tudo o que se mostra numa tela) é o que permite a
-- troca sem PCI.
CREATE TABLE IF NOT EXISTS "payment_cards" (
    "id"         TEXT NOT NULL,
    "accountId"  TEXT NOT NULL,
    -- O token do Asaas. Único: é o mesmo cartão.
    "asaasToken" TEXT NOT NULL,
    "brand"      TEXT,
    "last4"      TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_cards_asaasToken_key" ON "payment_cards" ("asaasToken");
CREATE INDEX IF NOT EXISTS "payment_cards_accountId_idx" ON "payment_cards" ("accountId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_cards_accountId_fkey'
    ) THEN
        ALTER TABLE "payment_cards"
            ADD CONSTRAINT "payment_cards_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
