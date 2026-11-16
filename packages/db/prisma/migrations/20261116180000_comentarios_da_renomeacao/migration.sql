-- Documenta no catálogo a renomeação de 27/10 e as views de compatibilidade.
--
-- ## Por que esta migração existe, e por que é esta
--
-- O caminho de migração nunca foi exercitado sob o papel `{slug}_migrator`:
-- a separação de privilégio entrou em 16/11/2026 e, desde então, todo deploy
-- encontrou "No pending migrations to apply". Ou seja, o primeiro `ALTER` de
-- verdade sob o papel novo seria o squash do baseline da Fase 4 — a operação
-- mais sensível do plano, estreando um caminho inédito.
--
-- Esta migração estreia o caminho com algo que não pode dar errado: `COMMENT`
-- não altera estrutura, não toca uma linha de dado e é idempotente. Mas exige
-- ser DONO da tabela, que é exatamente o privilégio de que `ALTER TABLE`
-- precisa — então ela prova o que precisa ser provado.
--
-- Medido antes de escrever (produção, 16/11): as 76 tabelas pertencem a
-- `odontobox_migrator`, ele tem USAGE e CREATE no schema `public` e grava em
-- `_prisma_migrations`. Se alguma dessas três coisas estiver errada em algum
-- dos seis bancos, é aqui que aparece — com custo zero.
--
-- ## E o conteúdo não é enfeite
--
-- A renomeação de 27/10 deixou três views de compatibilidade de pé, e o plano
-- prevê removê-las "um ciclo depois". Quem abrir o banco hoje vê `specialists`
-- e `professionals` lado a lado sem nada que diga qual é qual. O comentário
-- vive no catálogo, então responde a quem consulta o banco direto — que é
-- justamente quem não tem o runbook aberto.

COMMENT ON TABLE professionals IS
  'Quem presta o serviço. Renomeada de "specialists" em 2026-10-27 '
  '(20261027130000_degenericizar_agenda), ao neutralizar o schema para os três '
  'produtos. A view "specialists" continua de pé por compatibilidade e será '
  'removida numa migração própria.';

COMMENT ON TABLE availability_windows IS
  'Janelas de atendimento do profissional. Renomeada de "specialist_windows" '
  'em 2026-10-27. View de compatibilidade com o nome antigo ainda existe.';

COMMENT ON TABLE availability_window_services IS
  'Serviços que cabem em cada janela. Renomeada de '
  '"specialist_window_procedures" em 2026-10-27. View de compatibilidade com o '
  'nome antigo ainda existe.';

COMMENT ON VIEW specialists IS
  'COMPATIBILIDADE — lê "professionals". Criada na renomeação de 2026-10-27 '
  'para a janela entre a migração e a publicação do código novo. Nada no '
  'código a usa desde então; sai numa migração de contract.';

COMMENT ON VIEW specialist_windows IS
  'COMPATIBILIDADE — lê "availability_windows". Ver o comentário de '
  '"specialists".';

COMMENT ON VIEW specialist_window_procedures IS
  'COMPATIBILIDADE — lê "availability_window_services". Ver o comentário de '
  '"specialists".';
