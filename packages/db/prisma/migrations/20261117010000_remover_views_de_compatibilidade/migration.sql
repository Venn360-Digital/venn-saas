-- contract
--
-- A fase de remoção que a migração de 27/10 prometeu. Ela mesma dizia, no
-- cabeçalho: "A fase de remoção é a migração futura que dropa as views."
--
-- ## Por que agora, e não "um ciclo depois" vago
--
-- As três views existem **só no odontobox**: foram a ponte da janela entre o
-- `migrate deploy` e a publicação do Worker novo, em 12/11. Os clones aplicaram
-- a renomeação sem ponte, porque lá não havia dado de produção a proteger.
--
-- Medido em 17/11 nos três bancos de homologação, comparando o catálogo:
--
--   tabelas e colunas de aplicação  →  IDÊNTICOS nos três
--   índices                         →  232 nos três, IDÊNTICOS
--   conecta ↔ stagent               →  byte-idênticos nos três eixos
--   só no odontobox                 →  estas 3 views (+ pg_stat_statements,
--                                      que é extensão, não schema nosso)
--
-- Ou seja: **estas views são a última divergência de schema entre os seis
-- bancos.** Enquanto existirem, o baseline da Fase 4 não pode ser único — e o
-- baseline único é o que destrava o cutover dos clones, cujos
-- `_prisma_migrations` têm 9 checksums divergentes do monorepo e por isso
-- reprovam qualquer `migrate deploy` a partir daqui.
--
-- ## Por que é seguro
--
-- Nada no código as usa. Conferido por varredura em `apps/`, `packages/`,
-- `scripts/` e `infra/`: as 12 ocorrências de `specialist*` estão todas em
-- `infra/inventory/odontobox-schema-prod.sql`, que é retrato histórico de ANTES
-- da renomeação — lá elas aparecem como TABELAS. O `schema.prisma` não as
-- conhece; só cita "especialista" em comentário de documentação, em português.
--
-- View não guarda dado: dropar as três não toca uma linha. O dado vive em
-- `professionals`, `availability_windows` e `availability_window_services`, que
-- ficam como estão — inclusive os comentários de tabela que a migração de 16/11
-- escreveu nelas. Os comentários DAS VIEWS saem junto com as views, que é o
-- esperado.
--
-- `IF EXISTS` porque nos clones elas não existem, e esta migração tem de ser
-- inócua lá quando a história de migração voltar a ser comum.

DROP VIEW IF EXISTS specialist_window_procedures;
DROP VIEW IF EXISTS specialist_windows;
DROP VIEW IF EXISTS specialists;

-- Os comentários de 16/11 dizem "a view de compatibilidade ainda existe". Com o
-- DROP acima isso passa a ser falso, e comentário de catálogo errado é pior que
-- comentário ausente: quem consulta o banco direto é justamente quem não tem o
-- runbook aberto. Reescritos aqui, na mesma migração que os torna obsoletos.
--
-- Vale também porque o baseline da Fase 4 **não carrega comentário**: medido em
-- 17/11, `prisma migrate diff --from-empty --to-url` emite 0 `COMMENT ON` (e 0
-- `CREATE VIEW`). Então o texto que ficar aqui é o último que o catálogo verá
-- até alguém escrever outro.

COMMENT ON TABLE professionals IS
  'Quem presta o serviço. Renomeada de "specialists" em 2026-10-27 '
  '(20261027130000_degenericizar_agenda), ao neutralizar o schema para os três '
  'produtos. A view de compatibilidade com o nome antigo foi removida em '
  '2026-11-17 (20261117010000_remover_views_de_compatibilidade).';

COMMENT ON TABLE availability_windows IS
  'Janelas de atendimento do profissional. Renomeada de "specialist_windows" '
  'em 2026-10-27. A view de compatibilidade foi removida em 2026-11-17.';

COMMENT ON TABLE availability_window_services IS
  'Serviços que cabem em cada janela. Renomeada de '
  '"specialist_window_procedures" em 2026-10-27. A view de compatibilidade foi '
  'removida em 2026-11-17.';
