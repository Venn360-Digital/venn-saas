-- Passo 5: a lacuna agrupada vira sugestão, e a sugestão aprovada vira rascunho.
--
-- Aditiva: uma tabela nova e uma coluna nula.

-- A fila de aprovação.
--
-- Uma linha por **grupo** de lacunas, não por lacuna. Uma lista crua é inútil
-- depois da primeira semana: "quanto custa clareamento", "qual o valor do
-- clareamento" e "clareamento é caro?" são três lacunas e **um** documento
-- faltando — e a contagem de demanda, que é o que ordena a fila, ficaria errada
-- por desenho.
CREATE TABLE "gap_suggestions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,

    -- A formulação mais central do grupo. Não a primeira (seria a mais antiga,
    -- por acidente) nem a mais curta (seria "quanto?").
    "question" TEXT NOT NULL,
    -- Quantas lacunas caíram neste grupo. Ordena a fila.
    "demand" INTEGER NOT NULL DEFAULT 1,

    -- O slug do documento de acervo que recebe o rascunho: `servicos` ou `faq`.
    -- Documento de modo `prompt` nunca é alvo — sugestão automática não mexe na
    -- precedência do prompt, que é a parte do sistema em que um erro não tem como
    -- ser percebido depois.
    "targetSlug" TEXT NOT NULL,
    -- O texto proposto: o cabeçalho como pergunta, os sinônimos, e o branco
    -- marcado num comentário de HTML.
    --
    -- **A mineração não escreve a resposta.** A lacuna existe porque a resposta
    -- não está em lugar nenhum do acervo; um modelo que a escrevesse estaria
    -- inventando preço, horário ou prazo — e um instrutor aprovando vinte
    -- sugestões em sequência transformaria isso em fonte de verdade do agente.
    "draftText" TEXT NOT NULL,

    -- `nova` | `aprovada` | `descartada`.
    "status" TEXT NOT NULL DEFAULT 'nova',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gap_suggestions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "gap_suggestions" ADD CONSTRAINT "gap_suggestions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gap_suggestions" ADD CONSTRAINT "gap_suggestions_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A fila de aprovação por agente, ordenada por demanda. É a consulta da tela.
CREATE INDEX "gap_suggestions_agentId_status_demand_idx"
    ON "gap_suggestions" ("agentId", "status", "demand" DESC);

-- A qual sugestão esta lacuna foi atribuída.
--
-- `SetNull` porque descartar uma sugestão não pode apagar as lacunas: elas são o
-- registro do que o agente não soube, e continuam valendo para a semana
-- seguinte. É o mesmo raciocínio que fez a lacuna sobreviver à conversa.
ALTER TABLE "knowledge_gaps" ADD COLUMN "suggestionId" TEXT;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_suggestionId_fkey"
    FOREIGN KEY ("suggestionId") REFERENCES "gap_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "Quais lacunas ainda não foram agrupadas?" é a consulta que a mineração faz
-- toda semana, e sem índice ela varre a tabela inteira.
CREATE INDEX "knowledge_gaps_agentId_suggestionId_idx"
    ON "knowledge_gaps" ("agentId", "suggestionId");
