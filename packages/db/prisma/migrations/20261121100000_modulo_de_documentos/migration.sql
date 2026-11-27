-- Módulo de documentos: propostas, orçamentos e contratos.
--
-- Puramente aditiva. Seis tabelas novas do módulo, duas de apoio
-- (`product_groups`, `workspace_sequences`) e quatro colunas em
-- `products_services`. Nenhum DROP, nenhuma coluna existente alterada.
--
-- Escrita à mão, e não gerada por `prisma migrate dev`, por três coisas que o
-- Prisma não declara: a coluna GERADA de busca, os CHECK de coerência e o
-- preenchimento de `product_groups` a partir do texto livre que já existe.

-- ---------------------------------------------------------------------------
-- 1. Grupo do catálogo: de texto livre para registro
-- ---------------------------------------------------------------------------

CREATE TABLE "product_groups" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_groups_workspaceId_name_key" ON "product_groups"("workspaceId", "name");
CREATE INDEX "product_groups_workspaceId_order_idx" ON "product_groups"("workspaceId", "order");

ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- As quatro colunas novas do item de catálogo.
ALTER TABLE "products_services" ADD COLUMN "groupId" TEXT;
ALTER TABLE "products_services" ADD COLUMN "unit" TEXT;
ALTER TABLE "products_services" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Semeia os grupos a partir do texto livre que a clínica já digitou.
--
-- `trim` + `nullif` porque "Implantes " e "" existem nas bases reais; o
-- `DISTINCT` resolve "Implantes" repetido em vinte itens. A caixa NÃO é
-- normalizada de propósito: "implante" e "Implante" na mesma unidade são
-- decisão da clínica, não nossa — ela junta as duas na tela se quiser.
INSERT INTO "product_groups" ("id", "workspaceId", "name", "order", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    p."workspaceId",
    btrim(p."group"),
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT "workspaceId", "group" FROM "products_services"
    WHERE nullif(btrim("group"), '') IS NOT NULL
) p
ON CONFLICT ("workspaceId", "name") DO NOTHING;

UPDATE "products_services" ps
SET "groupId" = pg."id"
FROM "product_groups" pg
WHERE pg."workspaceId" = ps."workspaceId"
  AND pg."name" = btrim(ps."group");

CREATE INDEX "products_services_workspaceId_isActive_idx" ON "products_services"("workspaceId", "isActive");
CREATE INDEX "products_services_groupId_idx" ON "products_services"("groupId");

ALTER TABLE "products_services" ADD CONSTRAINT "products_services_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "product_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Contador por unidade
-- ---------------------------------------------------------------------------
--
-- Chave composta (unidade, nome) em vez de `autoincrement()`: a sequência do
-- Postgres é global à tabela, e a proposta nº 1 de uma clínica nova sairia
-- numerada com o total de propostas de todas as outras.

CREATE TABLE "workspace_sequences" (
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workspace_sequences_pkey" PRIMARY KEY ("workspaceId", "name")
);

ALTER TABLE "workspace_sequences" ADD CONSTRAINT "workspace_sequences_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Template do documento
-- ---------------------------------------------------------------------------

CREATE TABLE "proposal_templates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'proposta',
    "body" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_templates_workspaceId_name_key" ON "proposal_templates"("workspaceId", "name");
CREATE INDEX "proposal_templates_workspaceId_kind_idx" ON "proposal_templates"("workspaceId", "kind");

ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Zero ou UM modelo padrão por (unidade, tipo).
--
-- Índice único parcial, e não um CHECK: é a única forma de o banco recusar o
-- segundo padrão sem precisar ler as outras linhas. A mesma receita de
-- "exatamente um funil padrão".
CREATE UNIQUE INDEX "proposal_templates_um_padrao_por_tipo"
    ON "proposal_templates"("workspaceId", "kind")
    WHERE "isDefault";

-- ---------------------------------------------------------------------------
-- 4. O documento
-- ---------------------------------------------------------------------------

CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "templateId" TEXT,
    "userId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'proposta',
    "title" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- Busca sem acento, na mesma receita de `20261010100000_accent_insensitive_search`:
-- coluna mantida pelo Postgres, nunca escrita pelo app.
ALTER TABLE "proposals" ADD COLUMN "searchText" text
    GENERATED ALWAYS AS (public.immutable_unaccent(lower("title"))) STORED;

CREATE UNIQUE INDEX "proposals_currentRevisionId_key" ON "proposals"("currentRevisionId");
CREATE UNIQUE INDEX "proposals_workspaceId_number_key" ON "proposals"("workspaceId", "number");
CREATE INDEX "proposals_workspaceId_idx" ON "proposals"("workspaceId");
CREATE INDEX "proposals_dealId_idx" ON "proposals"("dealId");
CREATE INDEX "proposals_workspaceId_createdAt_idx" ON "proposals"("workspaceId", "createdAt");

-- ---------------------------------------------------------------------------
-- 5. A revisão
-- ---------------------------------------------------------------------------

CREATE TABLE "proposal_revisions" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "userId" TEXT,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_revisions_proposalId_version_key" ON "proposal_revisions"("proposalId", "version");
CREATE INDEX "proposal_revisions_proposalId_version_idx" ON "proposal_revisions"("proposalId", "version");
CREATE INDEX "proposal_revisions_status_idx" ON "proposal_revisions"("status");

-- A segunda linha de defesa do dinheiro.
--
-- O cálculo é no servidor (`lib/propostas/calculo.ts`) e o total que o
-- navegador manda é ignorado. Este CHECK existe para o dia em que um caminho
-- de código novo gravar uma revisão sem passar por lá: o banco recusa em vez
-- de deixar sair um documento cuja soma não fecha.
ALTER TABLE "proposal_revisions"
    ADD CONSTRAINT "proposal_revisions_total_coerente" CHECK ("total" = "subtotal" - "discount");

ALTER TABLE "proposal_revisions"
    ADD CONSTRAINT "proposal_revisions_valores_nao_negativos"
    CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "total" >= 0);

ALTER TABLE "proposal_revisions"
    ADD CONSTRAINT "proposal_revisions_versao_positiva" CHECK ("version" >= 1);

-- ---------------------------------------------------------------------------
-- 6. Itens
-- ---------------------------------------------------------------------------

CREATE TABLE "proposal_items" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "productServiceId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountPct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "proposal_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_items_revisionId_order_idx" ON "proposal_items"("revisionId", "order");
CREATE INDEX "proposal_items_productServiceId_idx" ON "proposal_items"("productServiceId");

-- Desconto é percentual: fora de 0–100 não é desconto, é erro de unidade
-- (alguém mandou 0.15 querendo 15%, ou 1500 querendo 15).
ALTER TABLE "proposal_items"
    ADD CONSTRAINT "proposal_items_desconto_percentual" CHECK ("discountPct" >= 0 AND "discountPct" <= 100);

ALTER TABLE "proposal_items"
    ADD CONSTRAINT "proposal_items_quantidade_positiva" CHECK ("quantity" > 0);

-- ---------------------------------------------------------------------------
-- 7. O link público e suas aberturas
-- ---------------------------------------------------------------------------

CREATE TABLE "proposal_shares" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedByName" TEXT,
    "acceptedIp" TEXT,
    "acceptedUserAgent" TEXT,

    CONSTRAINT "proposal_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_shares_token_key" ON "proposal_shares"("token");
CREATE INDEX "proposal_shares_revisionId_idx" ON "proposal_shares"("revisionId");
CREATE INDEX "proposal_shares_token_idx" ON "proposal_shares"("token");

-- Aceite é um ato com autor: sem nome, o carimbo não diz quem.
ALTER TABLE "proposal_shares"
    ADD CONSTRAINT "proposal_shares_aceite_tem_autor"
    CHECK ("acceptedAt" IS NULL OR "acceptedByName" IS NOT NULL);

CREATE TABLE "proposal_share_views" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "proposal_share_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_share_views_shareId_viewedAt_idx" ON "proposal_share_views"("shareId", "viewedAt");

-- ---------------------------------------------------------------------------
-- 8. Chaves estrangeiras do módulo
-- ---------------------------------------------------------------------------
--
-- Depois das tabelas todas, porque `proposals` e `proposal_revisions` se
-- apontam mutuamente: a revisão pertence à proposta, e a proposta aponta a
-- revisão vigente.

ALTER TABLE "proposals" ADD CONSTRAINT "proposals_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "proposal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_currentRevisionId_fkey"
    FOREIGN KEY ("currentRevisionId") REFERENCES "proposal_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "proposal_revisions" ADD CONSTRAINT "proposal_revisions_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_revisions" ADD CONSTRAINT "proposal_revisions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "proposal_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_productServiceId_fkey"
    FOREIGN KEY ("productServiceId") REFERENCES "products_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "proposal_shares" ADD CONSTRAINT "proposal_shares_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "proposal_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_shares" ADD CONSTRAINT "proposal_shares_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "proposal_share_views" ADD CONSTRAINT "proposal_share_views_shareId_fkey"
    FOREIGN KEY ("shareId") REFERENCES "proposal_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;
