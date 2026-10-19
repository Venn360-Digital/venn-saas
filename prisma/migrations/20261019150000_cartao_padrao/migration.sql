-- Qual dos cartões conhecidos cobra a mensalidade.
--
-- A conta pode ter vários (cada um entra pagando alguma coisa), e um deles é o
-- que o Asaas usa na recorrência. Guardar a marca aqui — em vez de deduzi-la
-- comparando bandeira e quatro dígitos com `subscriptions.paymentMethod` — é o
-- que evita dois cartões "Visa ••••4242" empatando na comparação.
ALTER TABLE "payment_cards"
    ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Um padrão por conta, garantido pelo banco e não pela rota: duas abas abertas
-- marcando cartões diferentes no mesmo segundo é exatamente o caso que a
-- aplicação sozinha não resolve.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_cards_um_padrao_por_conta"
    ON "payment_cards" ("accountId") WHERE "isDefault";
