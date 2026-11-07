-- O responsável que o rodízio escolheu passa a morar onde a tela o procura.
--
-- Dado, não estrutura: nenhuma coluna nasce ou morre aqui. Só preenche
-- `assignedTo` onde ele está nulo e `ownerId` não — ou seja, onde a distribuição
-- escolheu alguém e a escolha ficou numa coluna que a lista não lê.
--
-- ## O defeito, e por que o acervo não se conserta sozinho
--
-- `assignedTo` era o mutex do agente, então distribuir por ele calaria o bot no
-- ato de distribuir. Por isso `darDono` escrevia `ownerId`. Com o mutex movido
-- para `atendidaPor`, `darDono` passou a escrever `assignedTo` — mas só na
-- CHEGADA. O que já havia chegado continua com dono e sem responsável, e
-- continua invisível no filtro de quem o recebeu.
--
-- Medido antes de escrever: 3 conversas abertas na produção de origem, 2 na de
-- um dos irmãos. Número pequeno porque o portão é de ontem; o UPDATE existe
-- menos pelo volume e mais porque conversa que ninguém vê é conversa que
-- ninguém responde.
--
-- ## Só as abertas
--
-- `status <> 'closed'` de propósito: conversa finalizada não precisa aparecer na
-- fila de ninguém, e mexer nela mudaria contagem de histórico sem ganho nenhum.
--
-- ## Idempotente
--
-- A condição `assignedTo IS NULL` é a própria guarda: rodar de novo não acha
-- linha, e `prisma migrate deploy` rodando duas vezes é inofensivo — o que
-- importa num portão que roda a cada publish.
--
-- `atendidaPor` NÃO é tocado, pela mesma razão que `darDono` não o toca: ter
-- responsável não quer dizer que alguém esteja atendendo. Estas conversas
-- continuam com a IA, agora com nome no cartão.
UPDATE "conversations"
   SET "assignedTo" = "ownerId"
 WHERE "ownerId" IS NOT NULL
   AND "assignedTo" IS NULL
   AND status <> 'closed';
