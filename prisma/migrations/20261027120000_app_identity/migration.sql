-- T1 — Sentinela de identidade do app.
--
-- Tabela de controle gerida por migration + SQL cru (NÃO há model no
-- schema.prisma: o índice é funcional em ((true)), que o Prisma não expressa; o
-- projeto só usa `migrate deploy`, nunca `migrate dev`, então não há detecção de
-- drift). A guarda (T2/T3) e o endpoint (T4) a leem via `$queryRaw`.
--
-- NÃO insere linha. A linha é inserida UMA vez pelo provisionamento de cada
-- (app, ambiente) — na OdontoBox, no passo de ativação da Fase 03 em produção,
-- com confirmação. O índice único garante no máximo 1 linha por banco.

CREATE TABLE IF NOT EXISTS app_identity (
  slug        text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('production','stg')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_identity_singleton ON app_identity ((true));
