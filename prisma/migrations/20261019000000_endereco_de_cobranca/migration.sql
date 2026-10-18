-- O endereço de cobrança da conta, estruturado.
--
-- O cartão exige logradouro, número, bairro, CEP e telefone em campos
-- separados: o Asaas recusa o checkout sem os cinco. O que existia era
-- `workspaces.address`, uma linha de texto livre ("Rua das Princesas, 101"), e
-- partir string para preencher campo de cobrança dá endereço errado em fatura.
--
-- São coisas diferentes e as duas ficam: aqui é o endereço de **quem paga**;
-- lá, o endereço onde o paciente chega, que muda por unidade.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "postalCode"    TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "address"       TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "addressNumber" TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "complement"    TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "province"      TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "city"          TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "state"         TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "billingPhone"  TEXT;
