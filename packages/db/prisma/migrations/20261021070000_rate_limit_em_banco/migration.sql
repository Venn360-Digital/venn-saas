-- O contador do limite de requisições, em banco.
--
-- Achado na auditoria de segurança da migração: o Better Auth liga o limite
-- sozinho em produção, mas com `storage: "memory"` — que é um `new Map()` no
-- módulo (conferido em `node_modules/better-auth/dist/api/rate-limiter/index.mjs`).
--
-- Em Cloudflare Workers isso não limita nada. Cada isolate carrega o módulo de
-- novo e tem o próprio mapa; eles são muitos, espalhados por colo e descartados
-- com frequência. O limite efetivo seria "100 por janela POR ISOLATE", e
-- `/api/auth/sign-in/email` é endpoint público — para quem adivinha senha, isso
-- é o mesmo que não haver limite.
--
-- Em banco o contador é um só, compartilhado por todos os isolates.
CREATE TABLE "auth_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    -- BigInt: milissegundos desde a época passam de 2^31 desde 1971, e um
    -- inteiro de 32 bits estouraria em silêncio.
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits"("key");
