-- O funil de vendas vira registro: uma unidade pode ter vários, e um é o padrão.
--
-- ## Expand puro — nada aqui aperta
--
-- Uma tabela nova, uma coluna nova NULA em `pipeline_stages`, e duas escritas
-- de dados que só preenchem o que estava implícito. Código velho rodando
-- contra este schema continua igual: ele lê as fases pelo `workspaceId`, que
-- não mudou, e insere fase sem `pipelineId` — por isso a coluna fica nula e
-- NÃO recebe `SET NOT NULL` aqui. A migração roda antes do publish; se o
-- publish falhar depois dela, produção roda código velho contra schema novo
-- até o retry, e um `NOT NULL` derrubaria o "Acrescentar fase" nessa janela.
-- O aperto é a fase contract, num deploy seguinte, quando nenhum código
-- publicado inserir fase sem funil. Até lá `funilPadrao()` adota a órfã.
--
-- ## O que existia vira o funil padrão
--
-- Toda unidade com fase ganha UM funil, chamado "Funil de vendas", marcado como
-- padrão, e todas as fases dela passam a pertencer a ele. É exatamente o que a
-- unidade tinha — só que agora com nome e com um lugar para o segundo nascer.
-- Unidade sem fase nenhuma não ganha funil: o seed e o onboarding criam os dois
-- juntos quando ela precisar.
--
-- `gen_random_uuid()` e não `cuid`: o id é gerado pelo banco aqui, e o Prisma
-- aceita qualquer texto na coluna. Mesma escolha da migração de 30/10.

-- ───────────────────────────── A tabela ─────────────────────────────

CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- O funil do atendimento. Exatamente um por unidade; a rota troca os dois
    -- na mesma transação.
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    -- A ordem no seletor de Negócios.
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pipelines_workspaceId_idx" ON "pipelines"("workspaceId");

ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────── A fase aponta ─────────────────────────────

ALTER TABLE "pipeline_stages" ADD COLUMN "pipelineId" TEXT;

CREATE INDEX "pipeline_stages_pipelineId_idx" ON "pipeline_stages"("pipelineId");

ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipelineId_fkey"
    FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────── O que existia ─────────────────────────────

INSERT INTO "pipelines" ("id", "workspaceId", "name", "isDefault", "order", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."workspaceId", 'Funil de vendas', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "workspaceId" FROM "pipeline_stages") s;

UPDATE "pipeline_stages" st
SET "pipelineId" = p."id"
FROM "pipelines" p
WHERE p."workspaceId" = st."workspaceId"
  AND p."isDefault" = true
  AND st."pipelineId" IS NULL;

-- ───────────────────────────── O título do negócio ─────────────────────────────
--
-- Pedido do Andre em 20/11/2026: o negócio que nasce da mensagem se chamava
-- "Novo cliente - Fulano" (ou "Novo paciente - …", pelo vocabulário da marca),
-- e o prefixo só alongava o nome. O padrão passa a ser o nome da pessoa, e os
-- títulos já gravados perdem o prefixo aqui — só os que ainda o têm na frente;
-- um título que alguém editou à mão não casa com a expressão e fica como está.
UPDATE "deals"
SET "title" = regexp_replace("title", '^Novo (cliente|paciente) - ', '')
WHERE "title" ~ '^Novo (cliente|paciente) - ';
