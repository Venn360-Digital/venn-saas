-- Unidade suspensa: fora do ar, nada apagado.
--
-- Decisão do Andre em 2026-10-19, ao homologar o cancelamento de adicional:
-- "uma unidade nunca deve ser excluída, deve ser suspensa". Uma clínica tem
-- agenda, pacientes, conversas e histórico — devolver a vaga que ela ocupa não
-- pode significar destruir isso.
--
-- Suspender tira a unidade do ar (ninguém entra, agentes pausados, números
-- desconectados) e **libera a vaga contratada**, que é o que permite cancelar
-- o adicional correspondente. Reativar é um `UPDATE` de volta para nulo.
ALTER TABLE "workspaces"
    ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);

-- Toda contagem de unidade em uso filtra por isto, e é caminho quente: o teto
-- da conta é consultado em toda tela de plano e em toda criação de unidade.
CREATE INDEX IF NOT EXISTS "workspaces_accountId_suspendedAt_idx"
    ON "workspaces" ("accountId", "suspendedAt");
