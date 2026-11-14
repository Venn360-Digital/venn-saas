-- O checkout passa a ter dois tipos.
--
-- "assinatura" é a primeira contratação: cria a recorrência no Asaas e cobra o
-- mês. "proporcional" é o upgrade no meio de um ciclo pago: cobrança avulsa só
-- da diferença dos dias que faltam, sobre uma assinatura que já existe.
--
-- Sem a coluna, o processador teria de adivinhar pela existência da assinatura —
-- e adivinhar errado aqui é cobrar um mês cheio de quem pagou a diferença.
ALTER TABLE "asaas_checkouts" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'assinatura';
