-- O convite de usuário: o acesso nasce no aceite, não no clique do administrador.
--
-- Expand puro: uma tabela nova. Nada é reescrito e nada existente fica
-- obrigatório, então aplica antes do deploy. O caminho antigo (POST /api/users
-- criando com senha) continua funcionando até o código novo substituí-lo — é o
-- que permite migrar sem janela.

CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "canTransfer" BOOLEAN NOT NULL DEFAULT false,
    "recebeConversas" BOOLEAN NOT NULL DEFAULT true,
    "departmentIds" JSONB,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- Único: é por ele que o aceite acha a linha, e duas linhas com o mesmo resumo
-- seriam dois convites para um link só.
CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");

-- A lista da unidade, e a procura por e-mail antes de convidar de novo.
CREATE INDEX "invites_workspaceId_email_idx" ON "invites"("workspaceId", "email");
CREATE INDEX "invites_workspaceId_createdAt_idx" ON "invites"("workspaceId", "createdAt");

ALTER TABLE "invites"
    ADD CONSTRAINT "invites_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull nos dois: "quem convidou" e "quem aceitou" são registro de auditoria,
-- e perdê-los quando a pessoa sai da clínica apagaria como cada um entrou.
ALTER TABLE "invites"
    ADD CONSTRAINT "invites_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invites"
    ADD CONSTRAINT "invites_acceptedUserId_fkey"
    FOREIGN KEY ("acceptedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
