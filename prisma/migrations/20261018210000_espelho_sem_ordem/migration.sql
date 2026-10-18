-- O espelho de faturas deixa de depender da ordem de chegada.
--
-- `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` chegam quase juntos, e uma
-- retentativa do BullMQ pode aplicar o primeiro depois do segundo. Sem esta
-- coluna o último a escrever ganha, e o espelho diria "confirmado" numa cobrança
-- já recebida — mesmo com o envio sequencial do Asaas, porque a reordenação
-- nasce da nossa retentativa, não da entrega deles.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "lastEventAt" TIMESTAMP(3);
