-- A etapa de GANHO de cada funil, declarada em vez de deduzida da posição.
--
-- Por que existe: `lib/propostas/aceite.ts` movia o negócio aceito para a
-- última etapa por `order`, e `DEFAULT_PIPELINE_STAGES` termina numa etapa de
-- retrabalho. Aceitar uma proposta mandava o negócio para lá, e o relatório de
-- funil contava o ganho como retrabalho. Conferido por SQL nos três bancos de
-- homologação em 21/11/2026: `etapa_de_fechamento` resolvia para "Retrabalho".
--
-- Aditiva e sem mudança de comportamento: nasce `false` em toda linha, e o
-- aceite só prefere a marcada quando existe uma — senão continua na última.

alter table "pipeline_stages"
  add column "isWon" boolean not null default false;

-- No máximo UMA etapa de ganho por funil.
--
-- Índice único PARCIAL, e não `unique(pipelineId, isWon)`: o unique comum
-- proibiria duas etapas com `false` no mesmo funil, que é justamente o estado
-- normal. O parcial só vigia as marcadas.
--
-- Em vez de confiar na tela: duas marcadas fariam o aceite escolher uma em
-- silêncio, e o negócio ganho iria para a etapa errada sem erro nenhum.
create unique index "pipeline_stages_uma_etapa_de_ganho"
  on "pipeline_stages" ("pipelineId")
  where "isWon" = true;
