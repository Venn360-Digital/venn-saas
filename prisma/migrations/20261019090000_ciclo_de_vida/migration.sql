-- Fase 4 — ciclo de vida: inadimplência, carência e cancelamento.
--
-- Três perguntas que o banco ainda não sabia responder:
--
-- 1. "Desde quando esta conta está em atraso, e até quando ela tem para
--    regularizar?" A carência é de 3 dias no cartão e 2 no Pix (decisão do
--    Andre), contados do vencimento — e ela precisa estar gravada, porque quem
--    corta é um cron que roda de madrugada e não tem o evento em mãos.
--
-- 2. "Este adicional foi cancelado?" Cancelar não apaga a linha: o cliente
--    pagou o ciclo e usa a unidade até o fim dele. `canceledAt` é quando ele
--    pediu; `endsAt` é quando de fato deixa de valer — a renovação seguinte.
--
-- Idempotente: a migração roda no deploy e rodar duas vezes não pode quebrar.
ALTER TABLE "subscriptions"
    ADD COLUMN IF NOT EXISTS "pastDueSince" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "graceEndsAt"  TIMESTAMP(3);

ALTER TABLE "unit_addons"
    ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "endsAt"     TIMESTAMP(3);

-- O cron da inadimplência varre por `graceEndsAt`; sem índice ele lê a tabela
-- inteira todo dia para achar as poucas contas em atraso.
CREATE INDEX IF NOT EXISTS "subscriptions_graceEndsAt_idx" ON "subscriptions" ("graceEndsAt");

-- E a contagem de adicionais passa a filtrar por `endsAt` em toda consulta de
-- teto, que é caminho quente: toda tela de plano e todo limite passam por ela.
CREATE INDEX IF NOT EXISTS "unit_addons_accountId_endsAt_idx" ON "unit_addons" ("accountId", "endsAt");
