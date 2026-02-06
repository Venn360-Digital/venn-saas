-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "agentFunction" TEXT,
ADD COLUMN     "companyDescription" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "companySector" TEXT,
ADD COLUMN     "companyWebsite" TEXT,
ADD COLUMN     "initialMessage" TEXT,
ADD COLUMN     "jobDescription" TEXT,
ADD COLUMN     "visualConfig" JSONB,
ADD COLUMN     "voiceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "voiceModel" TEXT,
ADD COLUMN     "voiceTraining" TEXT;
