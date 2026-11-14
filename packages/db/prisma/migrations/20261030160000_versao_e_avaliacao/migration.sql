-- Passo 4 do estudo: o treinamento ganha rascunho, versão e um conjunto dourado.
--
-- Aditiva: duas colunas nulas, uma com padrão, e três tabelas novas. O código
-- antigo continua rodando sobre este banco.

-- O rascunho, ao lado do que está no ar.
--
-- Até aqui "Salvar" publicava: o texto ia para `content` e o agente passava a
-- responder por ele na mensagem seguinte. Isso torna impossível o princípio 5 do
-- estudo — nenhuma mudança de treinamento publica sem número —, porque não há
-- dois estados para comparar.
--
-- Nulo quer dizer "sem rascunho": o que está na tela é o que está no ar.
ALTER TABLE "agent_training_docs" ADD COLUMN "draftContent" TEXT;

-- A versão publicada **do agente**, não de cada documento.
--
-- Os sete documentos se contradizem entre si por desenho (há precedência
-- declarada entre eles), então comparar "Serviços v3 com Processo v1" compararia
-- um agente que nunca existiu. Zero quer dizer "nunca publicou".
ALTER TABLE "agents" ADD COLUMN "trainingVersion" INTEGER NOT NULL DEFAULT 0;

-- O instantâneo de cada publicação.
--
-- Um JSON com os sete documentos como estavam, porque é exatamente o que a volta
-- atrás precisa. Guardar diff seria menor e exigiria reconstruir o estado
-- aplicando a cadeia inteira — caro de escrever e fácil de errar justamente no
-- momento em que alguém está tentando desfazer um estrago.
CREATE TABLE "agent_training_versions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    -- [{ slug, content }] com TODOS os documentos, não só os que mudaram.
    "docs" JSONB NOT NULL,
    -- Os slugs que esta publicação mudou. Derivável do instantâneo anterior, mas
    -- guardado porque é o que a tela mostra e o que a medição usa para dizer
    -- "mexeu em Serviços e a recuperação de preço melhorou".
    "changed" JSONB NOT NULL,
    "note" TEXT,
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_training_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agent_training_versions" ADD CONSTRAINT "agent_training_versions_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma versão por número por agente: é o que impede duas publicações simultâneas
-- de gravarem a "versão 4" duas vezes e deixarem a volta atrás ambígua.
CREATE UNIQUE INDEX "agent_training_versions_agentId_version_key"
    ON "agent_training_versions" ("agentId", "version");
CREATE INDEX "agent_training_versions_agentId_createdAt_idx"
    ON "agent_training_versions" ("agentId", "createdAt");

-- O conjunto dourado: os casos que o instrutor aprovou no console de ensaio.
--
-- Nasce de "guardar este caso", que é a única fonte possível neste produto: a
-- segunda fonte da literatura — o atendente editar uma resposta sugerida antes
-- de enviar — não existe aqui, porque o agente envia direto.
CREATE TABLE "evaluation_cases" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    -- Os trechos que a busca entregou naquele ensaio, com o caminho do
    -- cabeçalho. Guardados para o juiz poder perguntar "a resposta se apoia
    -- nisto?" sem rodar a busca de novo — e para o caso continuar significando a
    -- mesma coisa se o acervo mudar depois.
    "chunks" JSONB NOT NULL,
    -- A resposta que o instrutor aprovou, ou a correção que ele escreveu.
    "reference" TEXT NOT NULL,
    -- 'aprovado' (a resposta do agente estava boa) ou 'corrigido' (o instrutor
    -- reescreveu). A distinção importa: caso corrigido é material de exemplo de
    -- estilo, caso aprovado é só regressão.
    "kind" TEXT NOT NULL DEFAULT 'aprovado',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_cases_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "evaluation_cases" ADD CONSTRAINT "evaluation_cases_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_cases" ADD CONSTRAINT "evaluation_cases_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "evaluation_cases_agentId_createdAt_idx" ON "evaluation_cases" ("agentId", "createdAt");

-- O resultado de cada bateria de avaliação.
--
-- Persiste porque o valor da medição é o **histórico**: "a versão 12 preferiu o
-- rascunho em 68% dos casos" só quer dizer algo ao lado do que a versão 11 deu.
-- O script de medição de recuperação só imprime no terminal, e é por isso que
-- ninguém sabe se o acerto subiu ou caiu desde a semana passada.
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    -- A versão publicada quando esta bateria rodou.
    "version" INTEGER NOT NULL,
    -- 'regressao' (o agente de agora contra a referência aprovada) ou
    -- 'pareado' (rascunho contra publicado), quando este último existir.
    "kind" TEXT NOT NULL DEFAULT 'regressao',
    "cases" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    -- Vereditos que o parser não entendeu. Contados à parte, nunca somados ao
    -- denominador: um parser que chuta "empate" injeta dado inventado na métrica
    -- que decide se o treinamento vai ao ar.
    "unreadable" INTEGER NOT NULL DEFAULT 0,
    "preference" DOUBLE PRECISION,
    -- Os avisos do canário: preferência de 100%, empate em tudo, amostra pequena.
    "warnings" JSONB NOT NULL,
    -- O detalhe por caso, para a tela poder abrir "quais pioraram".
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "evaluations_agentId_createdAt_idx" ON "evaluations" ("agentId", "createdAt");
