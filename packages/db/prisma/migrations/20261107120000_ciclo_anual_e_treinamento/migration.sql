-- Ciclo de cobrança (mensal ou anual), cancelamento desfazível e o treinamento
-- de agente como adicional de compra única.
--
-- Tudo **expand**: três colunas com DEFAULT, duas colunas nulas e uma tabela
-- nova. Nenhum DDL destrutivo, nenhum NOT NULL sem default — o código anterior
-- continua inserindo e lendo sem saber que isto existe, que é o que o portão de
-- produção exige (a migração roda no deploy command, antes do publish).
--
-- ## Por que duas datas na assinatura
--
-- `currentPeriodEnd` sempre foi duas coisas ao mesmo tempo: o fim da franquia de
-- crédito e a data da próxima cobrança. No mensal elas coincidem; no anual, não.
-- Quem paga doze meses adiantado não recebe 120.000 créditos para gastar em
-- janeiro — a franquia continua virando de 30 em 30 dias. Então a cobrança sai
-- para `renewsAt` e `currentPeriodEnd` fica sendo só o que o nome diz.
--
-- `renewsAt` nasce NULL, e isso é a queda para trás: assinatura criada antes
-- desta migração continua respondendo "quando é a próxima cobrança" por
-- `currentPeriodEnd`, que é a resposta certa para toda assinatura mensal — que é
-- tudo o que existia até aqui.
--
-- ## Por que `canceledAt`
--
-- Desfazer o cancelamento precisa de duas coisas que `status = 'canceled'` não
-- guarda: se ainda estamos dentro do período pago, e **quais** adicionais caíram
-- naquele gesto. Os adicionais levam este mesmo carimbo em `unit_addons.canceledAt`,
-- e é por ele que a restauração acha os certos sem ressuscitar o que o cliente
-- havia cancelado à mão semanas antes.
ALTER TABLE "subscriptions" ADD COLUMN "billingCycle" TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE "subscriptions" ADD COLUMN "renewsAt" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN "canceledAt" TIMESTAMP(3);

-- O ciclo e a cesta de treinamento na tentativa de checkout.
--
-- O evento do Asaas não diz o ciclo, e o valor pago não serve para deduzi-lo:
-- doze meses de Digital e um mês de Multiclínica são números diferentes hoje e
-- podem não ser amanhã. Sem a coluna, um `CHECKOUT_PAID` de assinatura anual
-- ativaria uma mensal — cliente cobrado por doze meses com renovação marcada
-- para trinta dias.
ALTER TABLE "asaas_checkouts" ADD COLUMN "cycle" TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE "asaas_checkouts" ADD COLUMN "trainings" INTEGER;

-- O treinamento contratado.
--
-- Sem `endsAt` e sem `canceledAt`, ao contrário de `unit_addons`: é compra
-- única, não contrato recorrente. O que esta tabela acompanha é o andamento de
-- um serviço humano — `status` e `doneAt` —, e `origin` registra se foi comprado
-- ou se veio no plano de topo em 12 meses, que é o que impede o brinde de ser
-- concedido duas vezes à mesma conta.
CREATE TABLE "training_addons" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL DEFAULT 'purchased',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "training_addons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "training_addons_accountId_idx" ON "training_addons"("accountId");
CREATE INDEX "training_addons_accountId_status_idx" ON "training_addons"("accountId", "status");

ALTER TABLE "training_addons" ADD CONSTRAINT "training_addons_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_addons" ADD CONSTRAINT "training_addons_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
