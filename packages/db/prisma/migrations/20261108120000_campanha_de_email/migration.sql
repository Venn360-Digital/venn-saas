-- A campanha passa a ter dois canais: WhatsApp oficial e e-mail.
--
-- ## Expand puro — nada aqui aperta
--
-- Toda coluna nova é nula ou tem default, as duas tabelas são novas, e as duas
-- únicas mudanças em coluna existente **afrouxam** (`DROP NOT NULL`). Então
-- código velho rodando contra este schema continua funcionando: uma campanha de
-- WhatsApp criada pela versão anterior tem `channel` = 'whatsapp' pelo default,
-- `integrationId` e `templateId` preenchidos, e nada mais mudou para ela.
--
-- É o que o portão de deploy exige: a migração roda no deploy command, e se o
-- publish falhar depois dela a produção roda código velho contra schema novo
-- até o retry.
--
-- ## Por que `integrationId` e `templateId` deixam de ser obrigatórios
--
-- Eram a forma de dizer "campanha é WhatsApp". Com e-mail no mesmo modelo, a
-- obrigatoriedade não desaparece — **muda de lugar**: quem a aplica passa a ser
-- a validação por canal na rota, porque o banco não sabe expressar
-- "obrigatório quando channel = 'whatsapp'".
--
-- A alternativa seria um CHECK com a condição. Recusada: o CHECK teria de
-- crescer a cada canal novo, e migração para acrescentar canal é exatamente o
-- que `channel String` evita.

-- ───────────────────────── Remetente por cliente ─────────────────────────

-- Campanha sai do domínio da própria unidade, nunca de um subdomínio nosso.
-- Reputação não se compartilha: quem importa lista comprada queima o domínio
-- por onde envia, e se esse domínio fosse nosso derrubaria a entrega de todos
-- os outros clientes — e a do transacional, que leva recuperação de senha.
CREATE TABLE "email_senders" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "fromLocal" TEXT NOT NULL DEFAULT 'contato',
    "fromName" TEXT NOT NULL,
    "replyTo" TEXT NOT NULL,
    -- Os três tokens do Easy DKIM. Cada um vira um CNAME que o cliente publica.
    "dkimTokens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    -- O estado cru do SES, para a tela dizer *por que* não verificou:
    -- TEMPORARY_FAILURE é esperar, FAILED é o CNAME estar errado.
    "dkimStatus" TEXT,
    "configurationSetName" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_senders_pkey" PRIMARY KEY ("id")
);

-- Um remetente por domínio em cada unidade: o SES guarda uma identidade por
-- domínio na conta inteira, então duas linhas para o mesmo domínio seriam duas
-- vistas do mesmo estado, divergindo na primeira verificação.
CREATE UNIQUE INDEX "email_senders_workspaceId_domain_key" ON "email_senders"("workspaceId", "domain");
-- O cron de verificação varre por status.
CREATE INDEX "email_senders_status_idx" ON "email_senders"("status");

ALTER TABLE "email_senders" ADD CONSTRAINT "email_senders_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────── Conteúdo em blocos ─────────────────────────

-- `blocks` é lista de blocos tipados, não HTML. HTML cru custaria: o dono da
-- clínica teria de escrevê-lo; um `<script>` colado de fora viraria problema
-- nosso (o projeto não tem sanitizador); e a casca não poderia melhorar sem
-- reescrever cada template já salvo.
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "preheader" TEXT,
    "blocks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_templates_workspaceId_idx" ON "email_templates"("workspaceId");

ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────── O canal na campanha ─────────────────────────

ALTER TABLE "broadcasts" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "broadcasts" ADD COLUMN "senderId" TEXT;
ALTER TABLE "broadcasts" ADD COLUMN "emailTemplateId" TEXT;
-- O assunto fica na campanha, e não no template, porque é o que mais muda entre
-- dois disparos do mesmo conteúdo.
ALTER TABLE "broadcasts" ADD COLUMN "subject" TEXT;
ALTER TABLE "broadcasts" ADD COLUMN "preheader" TEXT;

ALTER TABLE "broadcasts" ALTER COLUMN "integrationId" DROP NOT NULL;
ALTER TABLE "broadcasts" ALTER COLUMN "templateId" DROP NOT NULL;

CREATE INDEX "broadcasts_workspaceId_channel_idx" ON "broadcasts"("workspaceId", "channel");

-- `RESTRICT`, como a linha e o template do WhatsApp já são: apagar um remetente
-- que uma campanha usa apagaria a prova de por onde aquele disparo saiu.
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "email_senders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_emailTemplateId_fkey"
    FOREIGN KEY ("emailTemplateId") REFERENCES "email_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────────────────── Recibos do SES ─────────────────────────

-- O recibo do SES chega com o MessageId e nada mais; sem o índice, cada evento
-- seria uma varredura da tabela — e são até nove eventos por e-mail enviado.
ALTER TABLE "broadcast_recipients" ADD COLUMN "sesMessageId" TEXT;
-- Primeira abertura e primeiro clique. **Primeira**, não a última: quem abre
-- cinco vezes não é cinco pessoas, e contar repetição é relatório.
ALTER TABLE "broadcast_recipients" ADD COLUMN "openedAt" TIMESTAMP(3);
ALTER TABLE "broadcast_recipients" ADD COLUMN "clickedAt" TIMESTAMP(3);

CREATE INDEX "broadcast_recipients_sesMessageId_idx" ON "broadcast_recipients"("sesMessageId");

-- ───────────────────────── Canal da lista ─────────────────────────

-- Não é enfeite de tela: muda quem entra na lista. Lista de WhatsApp só aceita
-- contato com telefone; de e-mail, só com e-mail. Uma lista servindo aos dois
-- mandaria metade sem endereço para o fan-out só para ser descartada lá, e a
-- contagem na tela mentiria sobre o alcance da campanha.
ALTER TABLE "contact_lists" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';

-- ───────────────────────── Opt-out por canal ─────────────────────────

-- Coluna separada de `autoMessagesPausedAt` de propósito. Descadastrar-se de uma
-- campanha de e-mail não é pedir que o atendimento por WhatsApp pare, e tratar
-- como a mesma coisa calaria o canal onde a clínica realmente atende. A
-- recíproca também vale: quem respondeu "pare" no WhatsApp não pediu para sair
-- da newsletter.
ALTER TABLE "contacts" ADD COLUMN "emailOptOutAt" TIMESTAMP(3);
