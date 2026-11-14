-- Busca híbrida no acervo: a perna lexical e os dois índices.
--
-- Puramente ADITIVA: uma coluna gerada e dois índices. Nenhuma linha é reescrita,
-- nenhuma coluna sai, e o acervo continua sendo lido pela busca de vetor do jeito
-- que era até o deploy do código que usa isto.
--
-- POR QUE A PERNA LEXICAL
-- A medição de 2026-10-29 mostrou duas faces do mesmo defeito: `faq` dominava a
-- busca (36 recuperações contra 18, primeira em 13 contra 1) por ser escrita em
-- forma de pergunta, e `servicos` perdia as perguntas de preço porque "R$ 180"
-- não tem vizinho vetorial útil. O vetor não casa símbolo; `tsvector` casa.
--
-- A COLUNA É GERADA, E NÃO PREENCHIDA POR GATILHO
-- `GENERATED ALWAYS AS (...) STORED` é o mesmo recurso que a migração de busca
-- sem acento já usa em `contacts`, `deals` e `activities`. O Postgres mantém a
-- coluna sozinho: trecho novo entra com o vetor de texto pronto, e reindexar o
-- acervo não exige lembrar de atualizar nada. Gatilho precisaria de teste próprio
-- e falharia em silêncio quando esquecido.
--
-- `immutable_unaccent` vem daquela migração (20261010100000) e existe porque
-- `unaccent` da extensão não é marcada como imutável, e coluna gerada exige
-- imutabilidade. A configuração `portuguese` faz o radical e descarta palavra
-- vazia; o `unaccent` por fora é o que faz "orcamento" achar "orçamento".

ALTER TABLE "knowledge_documents" ADD COLUMN "searchVector" tsvector
    GENERATED ALWAYS AS (
        to_tsvector('portuguese', public.immutable_unaccent(coalesce(content, '')))
    ) STORED;

CREATE INDEX "knowledge_documents_searchVector_idx"
    ON "knowledge_documents" USING gin ("searchVector");

-- O ÍNDICE DE VETOR, QUE NUNCA EXISTIU
--
-- Até aqui `knowledge_documents` tinha só a chave e o índice de `agentId`: toda
-- busca era varredura com cálculo de distância linha a linha — na chamada mais
-- frequente do sistema, uma por mensagem recebida.
--
-- Com o acervo de hoje (poucas dezenas de trechos por agente) o planejador vai
-- pelo índice de `agentId` e o ganho é zero; o índice existe para **antes** de o
-- acervo crescer, não para consertar lentidão medida. HNSW e não IVFFlat porque
-- IVFFlat precisa de dado representativo no momento da criação — e aqui ele seria
-- criado num acervo pequeno, com listas dimensionadas para sempre.
--
-- Sem `CONCURRENTLY`: a migração do Prisma roda em transação, e com este volume o
-- lock é de milissegundos.

CREATE INDEX "knowledge_documents_embedding_hnsw_idx"
    ON "knowledge_documents" USING hnsw ("embedding" vector_cosine_ops);
