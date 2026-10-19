-- A compra de adicionais passa a ser cobrada, e o checkout precisa lembrar o
-- que foi comprado.
--
-- Até aqui `asaas_checkouts` guardava só o plano: a tentativa era sempre "o
-- plano X", e aplicar significava gravar o plano. Com a fase 3 a mesma tabela
-- carrega também "um pacote de 10.000 créditos e duas unidades", e o
-- processador do webhook não tem outra fonte para isso — o evento do Asaas
-- devolve valor e referência, não a cesta.
--
-- Idempotente como todas as outras: a migração roda no deploy, e rodar duas
-- vezes não pode quebrar.
ALTER TABLE "asaas_checkouts"
    ADD COLUMN IF NOT EXISTS "packCredits"   INTEGER,
    ADD COLUMN IF NOT EXISTS "packPriceCents" INTEGER,
    ADD COLUMN IF NOT EXISTS "units"         INTEGER,
    -- O lote de crédito avulso pertence a uma unidade (ver `credit_purchases`),
    -- e é a unidade de onde a compra partiu. Nulo nos checkouts de plano.
    ADD COLUMN IF NOT EXISTS "workspaceId"   TEXT;
