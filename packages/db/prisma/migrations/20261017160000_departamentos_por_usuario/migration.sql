-- N departamentos por usuário, e a fila deixando de ser um palpite.
--
-- `workspace_users.departmentId` era um departamento por pessoa, e isso não
-- respondia à pergunta que a clínica faz todo dia: "hoje a Recepção precisa
-- cobrir o Comercial". Com uma coluna só, a única saída era mover a pessoa de
-- departamento e lembrar de mover de volta na segunda — e esquecer disso é o
-- normal, não a exceção.
--
-- A tabela de junção é também o **único** botão da visibilidade de conversa: o
-- papel decide se a pessoa vê o próprio trabalho ou o de todos, e de quais
-- filas é esta tabela que diz. Não há um terceiro ajuste em lugar nenhum.
--
-- A coluna antiga é copiada antes de cair: quem tinha departamento continua
-- com ele, agora como o primeiro de uma lista que pode crescer.

CREATE TABLE IF NOT EXISTS "workspace_user_departments" (
    "workspaceUserId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "workspace_user_departments_pkey" PRIMARY KEY ("workspaceUserId", "departmentId")
);

CREATE INDEX IF NOT EXISTS "workspace_user_departments_departmentId_idx"
  ON "workspace_user_departments"("departmentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_user_departments_workspaceUserId_fkey'
  ) THEN
    ALTER TABLE "workspace_user_departments"
      ADD CONSTRAINT "workspace_user_departments_workspaceUserId_fkey"
      FOREIGN KEY ("workspaceUserId") REFERENCES "workspace_users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_user_departments_departmentId_fkey'
  ) THEN
    ALTER TABLE "workspace_user_departments"
      ADD CONSTRAINT "workspace_user_departments_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- O que a coluna antiga dizia, preservado. `ON CONFLICT DO NOTHING` para que
-- rodar a migração duas vezes não derrube nada.
INSERT INTO "workspace_user_departments" ("workspaceUserId", "departmentId")
SELECT wu."id", wu."departmentId"
FROM "workspace_users" wu
WHERE wu."departmentId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- E só então a coluna cai, com o índice e a chave estrangeira que vinham com
-- ela. `CASCADE` no índice não é necessário: derrubar a coluna leva os dois.
ALTER TABLE "workspace_users" DROP COLUMN IF EXISTS "departmentId";
