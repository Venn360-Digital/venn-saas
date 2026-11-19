-- A mensagem apagada passa a ter onde ser marcada.
--
-- Apagar no WhatsApp não apaga nada aqui: chega um `protocolMessage` de tipo
-- `REVOKE` apontando a mensagem que morreu. Sem esta coluna o evento não tinha
-- onde pousar — caía no "[Tipo de mensagem não suportado]" e virava um balão de
-- erro novo ao lado da original, que seguia visível. Ver `handleRevoke`.
--
-- `ADD COLUMN` nulo é instantâneo no Postgres 11+: não reescreve a tabela, e
-- `messages` é a maior do banco.
ALTER TABLE "messages" ADD COLUMN "deletedAt" TIMESTAMP(3);
