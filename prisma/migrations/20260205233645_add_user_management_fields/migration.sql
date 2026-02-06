-- AlterTable
ALTER TABLE "workspace_users" ADD COLUMN     "canTransfer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "workspace_users_departmentId_idx" ON "workspace_users"("departmentId");

-- AddForeignKey
ALTER TABLE "workspace_users" ADD CONSTRAINT "workspace_users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
