-- Uma passagem **por vez**, não uma passagem para sempre.
--
-- A migração `20261108200000_funil_de_vendas` criou
--
--     CREATE UNIQUE INDEX "funnel_runs_funnelId_contactId_key"
--         ON "funnel_runs"("funnelId", "contactId");
--
-- e o comentário dela dizia, com todas as letras: "O mesmo contato não entra
-- duas vezes no mesmo funil **enquanto a primeira não terminar**". O índice não
-- fazia isso. Sem filtro de status ele vale para sempre: terminada a primeira
-- passagem, aquele contato ficava **permanentemente** fora daquele funil.
--
-- O efeito é pior justamente onde o produto mais precisa do funil. Um funil de
-- retorno ("seis meses desde a última limpeza") pegaria cada paciente uma vez
-- na vida. Um de reativação idem. E não daria erro: a entrada seria recusada
-- pelo índice, em silêncio, e o sintoma seria "o funil parou de pegar gente"
-- meses depois, sem nada em log.
--
-- Índice parcial expressa a regra de verdade: a trava existe enquanto a
-- passagem está `running` — que é exatamente a janela em que entrar de novo
-- mandaria a sequência em dobro (o caso da etiqueta aplicada duas vezes).
--
-- ## Por que ele vive só aqui, e não no schema.prisma
--
-- Prisma não expressa índice parcial. Então o `@@unique` sai do modelo e o
-- índice fica declarado neste SQL, com o comentário do modelo apontando para
-- cá. `prisma migrate diff` vai relatá-lo como diferença — como já relata as
-- colunas geradas (`searchText`, `searchVector`) e os índices de vetor, que
-- também só existem aqui. É deriva conhecida, não deriva nova.
--
-- Expand: trocar um índice por outro não quebra código publicado. Nada lê nome
-- de índice, e nenhuma passagem existe ainda em ambiente nenhum.

DROP INDEX IF EXISTS "funnel_runs_funnelId_contactId_key";

CREATE UNIQUE INDEX "funnel_runs_funnelId_contactId_running_key"
    ON "funnel_runs"("funnelId", "contactId")
    WHERE "status" = 'running';
