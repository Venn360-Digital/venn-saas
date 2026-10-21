-- O cofre da aplicação, no lugar do `supabase_vault`.
--
-- O Neon não oferece `supabase_vault` nem `pgsodium`. O segredo continua
-- cifrado em repouso, mas a cifra passa a ser AES-256-GCM feita pela aplicação
-- (`src/lib/secrets/envelope.ts`), com a chave em Cloudflare Secrets — fora
-- deste banco, que é a condição que faltava na VPS.
--
-- `value` é jsonb porque guarda o envelope `{ v, iv, ct }`: `v` permite rotação
-- de chave sem parada.
CREATE TABLE "app_secrets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_secrets_name_key" ON "app_secrets"("name");
