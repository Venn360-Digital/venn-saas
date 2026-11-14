-- Better Auth no lugar do Supabase Auth.
--
-- O `auth.users`, `auth.sessions` e `auth.identities` do Supabase viviam num
-- schema próprio, fora do alcance do Prisma e atrás de uma chamada de rede. Aqui
-- passam a ser tabelas comuns no mesmo banco — o que permite ao Worker resolver
-- a sessão sem sair para a rede, e juntar usuário com `workspace_users` numa
-- consulta só.
--
-- **Os três levam prefixo `auth_` porque `Account` já existe e é outra coisa.**
-- Neste schema `accounts` é a conta que assina: `name` obrigatório, CNPJ,
-- endereço de cobrança, `asaasCustomerId`. O `account` do Better Auth é o par
-- credencial-provedor, onde mora o hash da senha. O CLI da biblioteca avisou
-- textualmente que sem a separação "inserts into account will fail", porque ela
-- não tem o que escrever num `name` obrigatório. Afrouxar `name` para resolver
-- seria pior: credencial de login e conta de cobrança na mesma tabela, com
-- `ownerUserId` apontando para linha de senha.

-- ---------------------------------------------------------------------------
-- users: a confirmação de e-mail
-- ---------------------------------------------------------------------------
-- `false` por omissão, e a confirmação não é exigida para entrar no primeiro
-- corte. O cadastro está aberto de propósito desde 2026-10-07 para homologação;
-- exigir verificação agora somaria um fluxo de e-mail ao corte que já troca
-- banco, cofre, storage e identidade.
ALTER TABLE "users" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- auth_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_token_key" ON "auth_sessions"("token");
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- ---------------------------------------------------------------------------
-- auth_accounts
-- ---------------------------------------------------------------------------
-- `password` é a única coluna deste banco que guarda hash de senha a partir
-- daqui. `users.hashedPassword` fica obsoleta e **não** é removida nesta
-- migração: enquanto o Supabase Auth ainda atender, remover a coluna seria
-- apagar o caminho de volta. A remoção é migração própria, depois do corte.
CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "password" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_accounts_userId_idx" ON "auth_accounts"("userId");
-- O par provedor+conta é como a biblioteca localiza a credencial no login.
CREATE INDEX "auth_accounts_providerId_accountId_idx" ON "auth_accounts"("providerId", "accountId");

-- ---------------------------------------------------------------------------
-- auth_verifications
-- ---------------------------------------------------------------------------
-- Token de uso único: confirmação de e-mail, redefinição de senha, OTP. A linha
-- é consumida no uso e expira sozinha — nada aqui é de longo prazo.
CREATE TABLE "auth_verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications"("identifier");

-- ---------------------------------------------------------------------------
-- Chaves estrangeiras
-- ---------------------------------------------------------------------------
-- CASCADE: apagar a pessoa apaga sessões e credenciais. É o único
-- comportamento correto — credencial órfã é credencial que ainda autentica.
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
