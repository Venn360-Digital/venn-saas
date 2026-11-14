-- O registro de quem da Venn360 entrou na conta de qual cliente.
--
-- Assumir a conta de um cliente é poder real: ver conversa de paciente, gravar
-- em nome da clínica. Sem registro, isso é indistinguível de invasão —
-- inclusive para nós, no dia em que alguém perguntar. A tarja na tela promete
-- este registro ao operador, e a mesma promessa vale para o cliente.
--
-- Sem chave estrangeira, e é deliberado: o registro tem de **sobreviver** ao
-- que ele descreve. Conta apagada com CASCADE levaria embora a prova de que
-- alguém entrou nela, que é exatamente a linha que mais importa guardar.
--
-- Aditiva: uma tabela nova e nada mais.

CREATE TABLE "platform_access_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "motivo" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "platform_access_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_access_log_accountId_startedAt_idx"
    ON "platform_access_log"("accountId", "startedAt");
CREATE INDEX "platform_access_log_userId_startedAt_idx"
    ON "platform_access_log"("userId", "startedAt");
