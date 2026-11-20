-- Formulários de captura de leads: o desenho e os envios.
--
-- Expand puro: duas tabelas novas, nenhuma coluna existente tocada. Código
-- velho rodando contra este schema não enxerga nada disto e segue igual.
--
-- O formulário vive numa página pública (`/f/<chave>`), que o site da
-- organização embute ou abre por link. Cada envio grava uma linha em
-- `lead_form_submissions` com as respostas inteiras, e vira ficha de contato e
-- negócio pelo código — não por gatilho de banco, pela mesma razão de sempre:
-- a regra de "mesmo telefone é a mesma pessoa" mora em `phoneVariants`, no
-- código, e não se reescreve em SQL.

-- ───────────────────────────── O desenho ─────────────────────────────

CREATE TABLE "lead_forms" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- A chave da URL pública. Identifica; não autoriza nada além de enviar.
    "publicKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    -- Os campos, na ordem. Forma validada em `lib/formularios/schema.ts`.
    "fields" JSONB NOT NULL,
    -- Textos, aparência e o destino do lead. Mesma validação.
    "settings" JSONB NOT NULL,
    "originId" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_forms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_forms_publicKey_key" ON "lead_forms"("publicKey");
CREATE INDEX "lead_forms_workspaceId_idx" ON "lead_forms"("workspaceId");

ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_originId_fkey"
    FOREIGN KEY ("originId") REFERENCES "origins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────────────────────── Os envios ─────────────────────────────

CREATE TABLE "lead_form_submissions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    -- A ficha que recebeu o envio. Nula se a ficha for apagada: o envio fica.
    "contactId" TEXT,
    -- As respostas, por id de campo.
    "data" JSONB NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "pageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_form_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_form_submissions_workspaceId_createdAt_idx" ON "lead_form_submissions"("workspaceId", "createdAt");
CREATE INDEX "lead_form_submissions_formId_createdAt_idx" ON "lead_form_submissions"("formId", "createdAt");
CREATE INDEX "lead_form_submissions_contactId_idx" ON "lead_form_submissions"("contactId");

ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "lead_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
