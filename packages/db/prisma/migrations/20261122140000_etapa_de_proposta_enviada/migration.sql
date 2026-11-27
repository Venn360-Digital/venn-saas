-- A etapa de PROPOSTA ENVIADA de cada funil, declarada em vez de deduzida.
--
-- Por que existe: o pedido da v2 do módulo de documentos é que "o valor final
-- da proposta retroalimente o negócio e a etapa da jornada". O valor já entra
-- no aceite; o envio não movia nada, e o funil continuava dizendo "Em
-- atendimento" para um negócio que já tinha proposta na mão do cliente.
--
-- Mesma forma da etapa de ganho (`20261122100000_etapa_de_ganho`): nasce
-- `false` em toda linha, e o envio só move quando a organização marcou uma —
-- senão fica onde está, que é o comportamento de hoje.

alter table "pipeline_stages"
  add column "isProposalSent" boolean not null default false;

-- No máximo UMA etapa de proposta enviada por funil. Índice único PARCIAL pela
-- mesma razão da etapa de ganho: o unique comum proibiria duas com `false`.
create unique index "pipeline_stages_uma_etapa_de_proposta_enviada"
  on "pipeline_stages" ("pipelineId")
  where "isProposalSent" = true;
