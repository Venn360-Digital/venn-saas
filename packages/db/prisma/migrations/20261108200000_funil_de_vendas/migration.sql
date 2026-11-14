-- O funil de vendas: desenho, passos e quem está dentro.
--
-- Expand puro: três tabelas novas e nenhuma coluna existente tocada. Código
-- velho rodando contra este schema não enxerga nada disto e segue igual.
--
-- ## O que NÃO está aqui, e por quê
--
-- O **estado da execução** — em que passo cada pessoa está, as variáveis, o
-- alarme da espera. Quem guarda isso é a instância do Cloudflare Workflows, e
-- `funnel_runs.instanceId` é o ponteiro para ela.
--
-- Guardar o passo atual aqui também pareceria útil e seria a pior escolha: duas
-- fontes para o mesmo fato, divergindo na primeira vez que a instância
-- avançasse e a gravação falhasse. A tela lê o progresso da instância, não
-- daqui.

-- ───────────────────────────── O desenho ─────────────────────────────

CREATE TABLE "funnels" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    -- O que faz alguém entrar. Json porque acrescentar um tipo de gatilho não
    -- deve ser migração.
    "trigger" JSONB NOT NULL,
    -- draft | published. Só `published` recebe gente: um funil meio escrito que
    -- já começasse a mandar mensagem seria o pior desfecho de "estou só
    -- experimentando".
    "status" TEXT NOT NULL DEFAULT 'draft',
    -- Sobe a cada publicação. Quem já está dentro continua na versão com que
    -- entrou — mudar o funil no meio do caminho de quem já está nele daria
    -- sequências pela metade, com passos que nunca existiram para aquela pessoa.
    "version" INTEGER NOT NULL DEFAULT 1,
    "maxAtivos" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "funnels_workspaceId_status_idx" ON "funnels"("workspaceId", "status");

ALTER TABLE "funnels" ADD CONSTRAINT "funnels_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────── Os passos ─────────────────────────────

CREATE TABLE "funnel_steps" (
    "id" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    -- `order` é o que o motor segue quando não há aresta explícita; `x`/`y` são
    -- só a posição no canvas e não têm significado para a execução.
    "order" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- Para onde ir depois. Vazio = fim do funil.
    "edges" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnel_steps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "funnel_steps_funnelId_order_idx" ON "funnel_steps"("funnelId", "order");

ALTER TABLE "funnel_steps" ADD CONSTRAINT "funnel_steps_funnelId_fkey"
    FOREIGN KEY ("funnelId") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────── Quem está dentro ────────────────────────

CREATE TABLE "funnel_runs" (
    "id" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    -- A instância do Workflows. Nulo só entre criar a linha e criar a
    -- instância — janela de milissegundos, e é por isso que a listagem tolera.
    "instanceId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    -- running | done | stopped | failed.
    --
    -- `stopped` é saída por **freio**, não por fim: humano assumiu a conversa,
    -- contato pediu para parar, funil despublicado. É estado diferente de
    -- `done` de propósito — na tela, "parou porque alguém atendeu" e "terminou"
    -- contam histórias opostas sobre o funil.
    "status" TEXT NOT NULL DEFAULT 'running',
    "stoppedReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "funnel_runs_pkey" PRIMARY KEY ("id")
);

-- Uma passagem por vez. O mesmo contato não entra duas vezes no mesmo funil
-- enquanto a primeira não terminar — sem isto, uma etiqueta aplicada duas vezes
-- mandaria a sequência em dobro.
CREATE UNIQUE INDEX "funnel_runs_funnelId_contactId_key" ON "funnel_runs"("funnelId", "contactId");
CREATE INDEX "funnel_runs_funnelId_status_idx" ON "funnel_runs"("funnelId", "status");
CREATE INDEX "funnel_runs_contactId_idx" ON "funnel_runs"("contactId");

ALTER TABLE "funnel_runs" ADD CONSTRAINT "funnel_runs_funnelId_fkey"
    FOREIGN KEY ("funnelId") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_runs" ADD CONSTRAINT "funnel_runs_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
