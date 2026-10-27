# Reprodutibilidade das migrations — Fase 01-E

**Data:** 2026-10-27 · **Veredito: IDÊNTICO.** As 48 migrations, aplicadas do
zero, produzem exatamente o schema de produção. Pode duplicar.

## Como foi medido

1. Projeto Neon temporário **`tmp-migration-check`** (`green-morning-27061854`),
   PG 18, região `aws-sa-east-1` — a mesma versão e região de produção.
2. `prisma migrate deploy` aplicou as **48 migrations** do zero. Todas com
   sucesso (“All migrations have been successfully applied”), sem erro, sem
   passo manual.
3. Comparação estrutural do schema `public` entre o tmp e a branch de
   **produção** (`polished-shape-42069569` / `br-weathered-water-b6wu2by1`),
   feita por SQL server-side (sem expor credencial de produção), em três
   assinaturas md5:

| Assinatura | Produção | Do zero (tmp) | Igual? |
|---|---|---|---|
| Tabelas (BASE TABLE) | 59 | 59 | ✅ |
| Colunas (nome/tipo/nullable/default) — md5 | `19c3c63d…` | `19c3c63d…` | ✅ |
| Índices (nome/tabela) — md5 | `7ebfef26…` | `7ebfef26…` | ✅ |
| Constraints por tabela (tipo/nome) — md5×58 | iguais | iguais | ✅ |

> Nota de método: uma primeira passada acusou md5 de constraints diferente.
> Era **artefato da consulta** — o `string_agg` agregado ordenava só por
> `table_name`, deixando a ordem dentro de cada tabela indefinida entre os dois
> bancos. Refeito o md5 **por tabela** com ordenação determinística
> (`constraint_type, constraint_name`), os 58 hashes batem um a um. Não há
> diferença real de constraints.

## Diferenças

Nenhuma entre produção e as migrations do zero.

Detalhe observado (não é drift de produção, é herança esperada das migrations):
a tabela `origins` carrega constraints NOT NULL com o prefixo antigo
`agencies_*_not_null` — reflexo do `ALTER TABLE agencies RENAME TO origins`
(migration `20261017120000_origem_unica`); o PostgreSQL não renomeia o nome
gerado da constraint. Isso aparece **igual** nos dois lados, justamente por o
caminho de migration ser o mesmo.

## Achado separado: staging está ATRÁS de produção

Comparação `compare_database_schema` (staging `br-bold-violet-b6phz4yu` × pai
produção) mostrou que **staging não tem** as tabelas do módulo de marketing:
`broadcasts`, `broadcast_lists`, `broadcast_recipients`, `contact_lists`,
`contact_list_members` e `whatsapp_templates` (migration
`20261027000000_marketing_broadcast` e a de `whatsapp_templates`). Ou seja, o
`migrate deploy` recente de produção não foi aplicado em staging. É lacuna de
processo de staging (ver Fase 02), não de reprodutibilidade.

## Pendência (R6)

O projeto `tmp-migration-check` (`green-morning-27061854`) **continua de pé**.
Aguardando “confirmo” do André para apagá-lo (comando destrutivo).
