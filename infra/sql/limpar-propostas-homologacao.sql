-- Limpeza da homologação: apaga propostas geradas e os modelos antigos.
--
-- Pedido do André em 27/11/2026, depois de homologar o módulo de documentos.
-- Rode no banco de HOMOLOGAÇÃO (branch `staging` do Neon), nunca em produção.
--
-- Projeto/branch da odontobox:
--   polished-shape-42069569 / br-bold-violet-b6phz4yu / banco `neondb`
--
-- ── O que isto apaga, e o que NÃO apaga ────────────────────────────────────
--
-- As chaves estrangeiras cascateiam a partir de `proposals`:
--   proposals → proposal_revisions → proposal_items
--                                  → proposal_shares → proposal_share_views
--
-- Então o DELETE abaixo leva junto revisões, itens, links e aberturas.
--
-- **Negócios não são tocados.** A ligação é `proposals.dealId → deals`, e não
-- o contrário: apagar a proposta não apaga o negócio dela.
--
-- `proposals.templateId → proposal_templates` é SET NULL, então a ordem
-- importa pouco; ainda assim as propostas vão primeiro, para o modelo não ser
-- apagado enquanto alguém aponta para ele.
--
-- Medido antes de escrever, na odontobox: 2 propostas, 7 revisões, 12 itens,
-- 4 links, 9 aberturas, 3 modelos. **Zero aceites** — nenhum contrato aceito se
-- perde. Confira os números antes de confirmar.

begin;

-- 1. Quanto há, antes.
select 'antes' as quando,
       (select count(*) from proposals) as propostas,
       (select count(*) from proposal_revisions) as revisoes,
       (select count(*) from proposal_items) as itens,
       (select count(*) from proposal_shares) as links,
       (select count(*) from proposal_share_views) as aberturas,
       (select count(*) from proposal_templates) as modelos,
       (select count(*) from deals) as negocios;

-- 2. As propostas, com o que cascateia.
delete from proposals;

-- 3. Os modelos antigos — os três semeados em 21/11, em corpo de texto da v1.
--    O recorte é por `sections is null`: é o que distingue um modelo da v1 de
--    um da v2, e evita apagar por engano um modelo novo caso esta linha rode
--    depois de "Restaurar padrões".
delete from proposal_templates where sections is null;

-- 4. Quanto ficou. `negocios` tem de ser o MESMO número de antes.
select 'depois' as quando,
       (select count(*) from proposals) as propostas,
       (select count(*) from proposal_revisions) as revisoes,
       (select count(*) from proposal_items) as itens,
       (select count(*) from proposal_shares) as links,
       (select count(*) from proposal_share_views) as aberturas,
       (select count(*) from proposal_templates) as modelos,
       (select count(*) from deals) as negocios;

-- Confira as duas linhas. Se `negocios` mudou, algo está errado:
--   rollback;
-- Se estiver certo:
commit;
