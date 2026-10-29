-- Os documentos de treinamento do agente, em Markdown.
--
-- Puramente aditiva: uma tabela nova, dois índices e uma chave estrangeira.
-- Nenhuma tabela existente é tocada, e nenhum dado é migrado aqui — o conteúdo
-- inicial de cada agente é gerado a partir dos campos antigos num passo
-- separado, e **as colunas antigas não caem nesta migração**. Derrubar coluna é
-- irreversível; gerar e conferir não é.
--
-- Por que uma tabela e não sete colunas em `agents`: o oitavo documento deixa
-- de ser migração, a tabela já é larga, e cada documento precisa de carimbo de
-- indexação próprio (`indexedHash`, `indexedAt`, `indexedChunks`).
--
-- `content` é a FONTE, não o resultado do corte. É a diferença que faltava:
-- `knowledge_documents` guarda só trechos — a coluna `metadata` dela nunca foi
-- escrita e o arquivo enviado não é persistido —, então quando o corte do
-- acervo melhora não há de onde recortar de novo. Com a fonte guardada,
-- reindexar é relançar o conteúdo.
-- CreateTable
CREATE TABLE "agent_training_docs" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "indexedHash" TEXT,
    "indexedAt" TIMESTAMP(3),
    "indexedChunks" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_training_docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_training_docs_agentId_idx" ON "agent_training_docs"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_training_docs_agentId_slug_key" ON "agent_training_docs"("agentId", "slug");

-- AddForeignKey
ALTER TABLE "agent_training_docs" ADD CONSTRAINT "agent_training_docs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

