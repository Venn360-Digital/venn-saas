-- Uma lista de origem só, e a palavra "canal" significando uma coisa só.
--
-- Havia duas listas com o mesmo nome e nenhuma relação entre elas: `agencies`,
-- que o Negócio chamava de "Origem", e `contacts.source`, que a ficha do
-- paciente também chamava de "Origem". A clínica cadastrava "V4" numa e o
-- sistema gravava "whatsapp" na outra. Pior: `contacts.source` guardava três
-- planos diferentes na mesma coluna — canal (`whatsapp`, `instagram`, `site`),
-- nascimento da ficha (`manual`, `import`, `ligacao`) e origem comercial
-- (`google`, `facebook`, `indicacao`) — então "de onde vêm nossos pacientes?"
-- respondia "WhatsApp", que é por onde eles escrevem e não diz nada.
--
-- Seis passos, nesta ordem, porque o 4 depende do 1:
--
--   1. `agencies` → `origins`: a lista única, agora apontada pela ficha, pelo
--      negócio e pela linha.
--   2. `deals.agencyId` → `originId`, e `deals.source` morre — era escrito
--      pelo worker ao abrir o negócio automático e lido por absolutamente
--      nada, nem tela nem relatório.
--   3. `contacts.source` → `createdVia`, que passa a guardar só o nascimento.
--   4. `contacts.originId`, preenchido a partir do que havia de origem de
--      verdade na coluna antiga.
--   5. `agent_integrations.defaultOriginId`: a linha semeia a origem. É o que
--      separa o WhatsApp QR da V4 do WhatsApp QR do Nando, que são o mesmo
--      canal e vêm de agências diferentes.
--   6. As chaves estrangeiras das três colunas novas.

-- (1) A lista única. Renomear preserva o que a clínica já cadastrou — são os
-- nomes das agências dela, e recriar a tabela os perderia.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'agencies') THEN
    ALTER TABLE "agencies" RENAME TO "origins";
    ALTER TABLE "origins" RENAME CONSTRAINT "agencies_pkey" TO "origins_pkey";
    ALTER TABLE "origins" RENAME CONSTRAINT "agencies_workspaceId_fkey" TO "origins_workspaceId_fkey";
    ALTER INDEX "agencies_workspaceId_name_key" RENAME TO "origins_workspaceId_name_key";
    ALTER INDEX "agencies_workspaceId_idx" RENAME TO "origins_workspaceId_idx";
  END IF;
END $$;

-- (2) O negócio aponta para a lista pelo nome novo, e perde a coluna morta.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'deals' AND column_name = 'agencyId'
  ) THEN
    ALTER TABLE "deals" RENAME COLUMN "agencyId" TO "originId";
    ALTER TABLE "deals" RENAME CONSTRAINT "deals_agencyId_fkey" TO "deals_originId_fkey";
    ALTER INDEX "deals_agencyId_idx" RENAME TO "deals_originId_idx";
  END IF;
END $$;

ALTER TABLE "deals" DROP COLUMN IF EXISTS "source";

-- (3) A coluna da ficha passa a dizer só como ela nasceu.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'contacts' AND column_name = 'source'
  ) THEN
    ALTER TABLE "contacts" RENAME COLUMN "source" TO "createdVia";
  END IF;
END $$;

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "originId" TEXT;

CREATE INDEX IF NOT EXISTS "contacts_originId_idx" ON "contacts"("originId");

-- (4a) O que era canal não é origem nem nascimento: vira `inbound`, que é o
-- que esses três valores de fato diziam — "o paciente escreveu primeiro".
UPDATE "contacts"
SET "createdVia" = 'inbound'
WHERE lower("createdVia") IN ('whatsapp', 'instagram', 'site');

-- (4b) O que sobrou e não é nascimento conhecido era origem comercial de
-- verdade ("google", "facebook", "indicacao") e entra na lista.
--
-- O id é determinístico, no padrão `seed_` das outras migrações, para que
-- rodar duas vezes não duplique. `ON CONFLICT DO NOTHING` cobre o caso de a
-- clínica já ter uma agência com esse nome: aí a origem existente é reusada,
-- e é por nome — não por id — que o passo seguinte liga as fichas.
INSERT INTO "origins" ("id", "workspaceId", "name", "createdAt")
SELECT DISTINCT
    'seed_origin_' || c."workspaceId" || '_' || lower(c."createdVia"),
    c."workspaceId",
    initcap(c."createdVia"),
    now()
FROM "contacts" c
WHERE c."createdVia" IS NOT NULL
  AND btrim(c."createdVia") <> ''
  AND lower(c."createdVia") NOT IN ('inbound', 'manual', 'import', 'ligacao')
ON CONFLICT DO NOTHING;

-- (4c) A ficha passa a apontar para a lista, e `createdVia` fica **nulo** em
-- vez de receber um palpite: de uma ficha que dizia "facebook" não se deduz se
-- alguém a digitou ou se ela veio de planilha, e inventar isso aqui mentiria
-- num campo que ninguém mais poderia conferir.
UPDATE "contacts" c
SET "originId" = o."id",
    "createdVia" = NULL
FROM "origins" o
WHERE o."workspaceId" = c."workspaceId"
  AND lower(o."name") = lower(c."createdVia")
  AND c."originId" IS NULL;

-- (5) A linha semeia a origem de quem escreve por ela.
ALTER TABLE "agent_integrations" ADD COLUMN IF NOT EXISTS "defaultOriginId" TEXT;

CREATE INDEX IF NOT EXISTS "agent_integrations_defaultOriginId_idx"
  ON "agent_integrations"("defaultOriginId");

-- (6) As chaves estrangeiras. `SET NULL` nas três: apagar uma origem da lista
-- não pode levar embora a ficha do paciente, o negócio nem a linha.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_originId_fkey') THEN
    ALTER TABLE "contacts"
      ADD CONSTRAINT "contacts_originId_fkey"
      FOREIGN KEY ("originId") REFERENCES "origins"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_integrations_defaultOriginId_fkey') THEN
    ALTER TABLE "agent_integrations"
      ADD CONSTRAINT "agent_integrations_defaultOriginId_fkey"
      FOREIGN KEY ("defaultOriginId") REFERENCES "origins"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
