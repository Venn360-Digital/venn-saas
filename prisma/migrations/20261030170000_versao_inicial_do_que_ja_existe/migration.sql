-- O que já estava no ar ganha a versão 1.
--
-- A migração anterior criou `trainingVersion` com padrão zero, e zero quer dizer
-- "nunca publicou". Isso é verdade para um agente novo e **mentira** para o
-- agente que já tem os sete documentos respondendo paciente desde antes do
-- passo 4: a tela diria "nunca publicado" sobre texto que está no ar, e a volta
-- atrás não teria piso nenhum para onde voltar.
--
-- Então o estado de hoje é declarado como a versão 1. Não é reescrita de
-- história: é dizer a verdade sobre o que está publicado agora.
--
-- Idempotente de propósito, pelo `NOT EXISTS`: rodar duas vezes não cria duas
-- versões 1, e o índice único recusaria a segunda de qualquer forma — melhor não
-- chegar lá.
INSERT INTO "agent_training_versions" ("id", "agentId", "version", "docs", "changed", "note", "createdAt")
SELECT
    -- `gen_random_uuid()` e não `cuid`: o id é gerado pelo banco aqui, e o
    -- formato não importa a ninguém que leia — a chave de negócio é
    -- (agentId, version).
    gen_random_uuid()::text,
    d."agentId",
    1,
    -- O instantâneo tem TODOS os documentos gravados daquele agente, não só os
    -- preenchidos: instantâneo pela metade não serve para voltar atrás.
    (
        SELECT jsonb_agg(jsonb_build_object('slug', t."slug", 'content', t."content") ORDER BY t."slug")
        FROM "agent_training_docs" t
        WHERE t."agentId" = d."agentId"
    ),
    -- Nada "mudou" nesta versão: ela é o ponto de partida, não uma publicação.
    -- Dizer o contrário faria a tela mostrar sete documentos alterados numa
    -- versão que ninguém publicou.
    '[]'::jsonb,
    'Estado anterior ao versionamento, declarado como versão 1.',
    CURRENT_TIMESTAMP
FROM "agent_training_docs" d
WHERE length(btrim(d."content")) > 0
  AND NOT EXISTS (
      SELECT 1 FROM "agent_training_versions" v WHERE v."agentId" = d."agentId"
  )
GROUP BY d."agentId";

-- E o agente passa a dizer em que versão está.
UPDATE "agents" a
SET "trainingVersion" = 1
WHERE a."trainingVersion" = 0
  AND EXISTS (SELECT 1 FROM "agent_training_versions" v WHERE v."agentId" = a."id" AND v."version" = 1);
