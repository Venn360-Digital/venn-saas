-- Quem é o paciente no Instagram.
--
-- Coluna própria em vez de reaproveitar `phone`: o IGSID é um id de dezessete
-- dígitos escopado ao nosso aplicativo da Meta, não um telefone. Em `phone` ele
-- apareceria formatado como celular na ficha e passaria pela regra do nono
-- dígito, que inventaria uma segunda forma inexistente para ele.
--
-- O índice único é por workspace e ignora nulos (comportamento padrão do
-- Postgres), igual ao de `phone`: a clínica que nunca usou Instagram tem a
-- coluna nula em todas as fichas e nada muda para ela.
ALTER TABLE "contacts" ADD COLUMN "instagramId" TEXT;

CREATE UNIQUE INDEX "contacts_workspaceId_instagramId_key"
    ON "contacts"("workspaceId", "instagramId");

CREATE INDEX "contacts_instagramId_idx" ON "contacts"("instagramId");
