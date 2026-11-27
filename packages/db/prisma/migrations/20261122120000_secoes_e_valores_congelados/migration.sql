-- Documentos v2, fundação (F0): seções tipadas e valores congelados.
--
-- Tudo aditivo e nulável. Modelo e revisão da v1 continuam funcionando com
-- estas colunas nulas: o render converte `body` em seções em tempo de execução,
-- e a revisão sem valores congelados lê os valores vivos — exatamente como
-- antes. Nenhuma linha existente é tocada.

alter table "proposal_templates"
  add column "sections" jsonb,
  add column "theme"    jsonb,
  add column "source"   jsonb;

alter table "proposal_revisions"
  add column "sections"       jsonb,
  add column "variableValues" jsonb;
