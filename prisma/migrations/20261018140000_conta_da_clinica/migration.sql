-- O CNPJ de cobrança e a logomarca sobem para a conta.
--
-- Os dois campos existiam em `workspaces`, de quando havia uma clínica por
-- conta. Com várias unidades eles respondem a perguntas da conta: o CNPJ é o da
-- fatura (um por assinatura) e a logomarca é a do cabeçalho (um por sessão, que
-- não pode mudar quando se troca de clínica).
--
-- `workspaces.cnpj` **fica**: a franquia tem CNPJ próprio, e esse é o lugar
-- dele. Vazio na filial não é defeito, é o caso comum.
--
-- Idempotente: a migração roda no deploy, contra um banco que já pode tê-la
-- recebido.

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "cnpj" TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "logo" TEXT;

-- Herda da unidade **mais antiga** de cada conta: é a que o cadastro criou, e
-- portanto a que recebeu o CNPJ e a logo que alguém digitou. Cada coluna com o
-- seu próprio guarda de nulo, para que rodar de novo não desfaça o que já foi
-- editado na conta nem dependa de as duas estarem vazias juntas.
WITH primeira AS (
    SELECT DISTINCT ON ("accountId") "accountId", "cnpj", "logo"
      FROM "workspaces"
     ORDER BY "accountId", "createdAt" ASC
)
UPDATE "accounts" a
   SET "cnpj" = primeira."cnpj"
  FROM primeira
 WHERE primeira."accountId" = a."id"
   AND a."cnpj" IS NULL
   AND primeira."cnpj" IS NOT NULL;

WITH primeira AS (
    SELECT DISTINCT ON ("accountId") "accountId", "cnpj", "logo"
      FROM "workspaces"
     ORDER BY "accountId", "createdAt" ASC
)
UPDATE "accounts" a
   SET "logo" = primeira."logo"
  FROM primeira
 WHERE primeira."accountId" = a."id"
   AND a."logo" IS NULL
   AND primeira."logo" IS NOT NULL;
