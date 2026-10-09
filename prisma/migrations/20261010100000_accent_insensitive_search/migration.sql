-- Busca que não distingue acento.
--
-- "André", "Andre" e "andre" tinham de localizar a mesma pessoa, e `mode:
-- 'insensitive'` do Prisma resolve só a caixa — ILIKE não toca em acento. As
-- alternativas eram piores: comparar com `unaccent()` em cada consulta obriga
-- SQL cru nas dez rotas que buscam (e perde paginação e contagem do Prisma), e
-- expandir o termo em variantes no app gera falso positivo.
--
-- Aqui cada tabela ganha uma coluna gerada com o texto já normalizado —
-- minúsculo e sem acento — e as rotas passam a comparar contra ela. O Postgres
-- mantém a coluna, então não existe o caminho em que alguém esquece de
-- atualizá-la.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- `unaccent` é STABLE (consulta o dicionário), e coluna gerada exige IMMUTABLE.
-- Envolver numa função imutável é a receita documentada: o dicionário é fixo
-- nesta instalação, então a promessa se sustenta.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

ALTER TABLE "contacts" ADD COLUMN "searchText" text
    GENERATED ALWAYS AS (
        public.immutable_unaccent(lower(
            coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '')
        ))
    ) STORED;

ALTER TABLE "deals" ADD COLUMN "searchText" text
    GENERATED ALWAYS AS (public.immutable_unaccent(lower(title))) STORED;

ALTER TABLE "activities" ADD COLUMN "searchText" text
    GENERATED ALWAYS AS (
        public.immutable_unaccent(lower(title || ' ' || coalesce(description, '')))
    ) STORED;

ALTER TABLE "products_services" ADD COLUMN "searchText" text
    GENERATED ALWAYS AS (
        public.immutable_unaccent(lower(
            name || ' ' || coalesce(description, '') || ' ' || coalesce(sku, '') || ' ' || coalesce("group", '')
        ))
    ) STORED;

ALTER TABLE "departments" ADD COLUMN "searchText" text
    GENERATED ALWAYS AS (
        public.immutable_unaccent(lower(name || ' ' || coalesce(description, '')))
    ) STORED;

ALTER TABLE "tags" ADD COLUMN "searchText" text
    GENERATED ALWAYS AS (public.immutable_unaccent(lower(name))) STORED;

ALTER TABLE "users" ADD COLUMN "searchText" text
    GENERATED ALWAYS AS (
        public.immutable_unaccent(lower(
            coalesce(name, '') || ' ' || coalesce("lastName", '') || ' ' || email
        ))
    ) STORED;

-- Índice de trigrama só onde a busca é por pedaço do meio da palavra e o volume
-- cresce. Nas tabelas de apoio (etiquetas, departamentos) a varredura é de
-- dezenas de linhas e o índice custaria mais manutenção do que economiza.
CREATE INDEX "contacts_searchText_trgm" ON "contacts" USING gin ("searchText" gin_trgm_ops);
CREATE INDEX "deals_searchText_trgm" ON "deals" USING gin ("searchText" gin_trgm_ops);
CREATE INDEX "activities_searchText_trgm" ON "activities" USING gin ("searchText" gin_trgm_ops);
