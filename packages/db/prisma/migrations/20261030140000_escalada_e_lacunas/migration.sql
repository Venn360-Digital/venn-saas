-- Passo 3 do estudo: a entrega à equipe deixa de ser frase e vira estado, e a
-- pergunta que o agente não soube responder deixa de se perder.
--
-- Aditiva de ponta a ponta: duas colunas nulas e uma tabela nova. Nada do que
-- existe muda de forma, então o código antigo continua rodando sobre este banco
-- — o que importa porque a produção dos clones não tem caminho de migração.

-- Quando esta conversa foi entregue a gente, e por quê.
--
-- Existe porque `assignedTo` responde a pergunta errada. Ele significa "um
-- humano está atendendo", e é o mutex que cala o agente — mas a regra
-- `notify_human` sem destino, e o teto de interações, entregavam a conversa
-- deixando `assignedTo` nulo. Resultado medido: o agente voltava a responder na
-- mensagem seguinte, por cima de uma entrega que já tinha sido anunciada ao
-- paciente. `handoffAt` é o que torna a entrega verdadeira mesmo sem
-- responsável definido.
ALTER TABLE "conversations" ADD COLUMN "handoffAt" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "handoffReason" TEXT;

-- O que o agente não soube responder.
--
-- Uma linha por pergunta que terminou em promessa de confirmação com busca
-- fraca. É a matéria-prima do passo 5 (mineração de lacunas e FAQ sugerida): sem
-- guardar a pergunta no momento em que ela falha, o passo 5 teria de adivinhá-la
-- relendo conversas inteiras com um modelo.
CREATE TABLE "knowledge_gaps" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "conversationId" TEXT,
    -- A fala do paciente que ficou sem resposta.
    "question" TEXT NOT NULL,
    -- 'automatica' (detectada pelos dois sinais) ou 'ferramenta' (o modelo
    -- chamou `nao_encontrei` sobre material que a busca trouxe).
    "source" TEXT NOT NULL DEFAULT 'automatica',
    -- A melhor similaridade da busca, quando houve alguma. Nula quando a busca
    -- não devolveu nada ou devolveu só acerto lexical — e essa distinção é o que
    -- separa "falta documento" de "o documento existe e não foi encontrado".
    "bestSimilarity" DOUBLE PRECISION,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    -- Preenchido pelo passo 5. Fica aqui para a tabela não precisar de segunda
    -- migração quando a mineração entrar.
    "status" TEXT NOT NULL DEFAULT 'nova',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id")
);

-- A conversa é `SetNull` e não `Cascade`: apagar a conversa não pode apagar a
-- lacuna. O valor dela é justamente sobreviver ao atendimento — é o que a
-- mineração semanal vai ler.
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Os dois recortes que o passo 5 e o painel pedem: a fila de aprovação por
-- agente, e "quantas lacunas neste atendimento?", que é a conta que decide a
-- escalada e roda a cada resposta.
CREATE INDEX "knowledge_gaps_agentId_status_createdAt_idx"
    ON "knowledge_gaps" ("agentId", "status", "createdAt");
CREATE INDEX "knowledge_gaps_conversationId_createdAt_idx"
    ON "knowledge_gaps" ("conversationId", "createdAt");
