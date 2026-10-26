# FASE 02 — Saneamento da Odontobox360 (antes de duplicar)

**Onde executar:** repositório da Odontobox, branch `chore/dup-saneamento` a partir de `main`.
**Modo:** Plan mode. Apresente o plano completo, baseado no relatório da Fase 01, e só execute após "aprovado".
**Antes de começar:** leia `infra/runbook/01-REGRAS-GLOBAIS.md` e `infra/reports/odontobox/fase-01.md`.

---

## Objetivo

Garantir que a base a ser duplicada esteja íntegra. Defeitos não corrigidos aqui viram três defeitos depois.

## Escopo (execute apenas os itens que a Fase 01 marcou como necessários)

### 1. Paridade de staging da Odontobox

Para cada achado **crítico** ou **alto** da tabela de paridade (Fase 01, item H):

- Recurso compartilhado entre produção e staging → crie o recurso de staging separado com o nome existente + sufixo de staging coerente com o padrão atual da Odontobox. Repontar SOMENTE o ambiente de staging.
- **NUNCA** altere bindings, secrets ou rotas do Worker de produção da Odontobox nesta fase.
- Se o staging envia e-mail ou WhatsApp para clientes reais, implemente a allowlist de destinatários em staging (`OUTBOUND_ALLOWLIST`). Fora da lista, o envio é registrado em log e descartado.
- Crons com efeito externo em staging: desligar ou ativar modo simulado (`SIMULATE_EXTERNAL=true`).
- Access protegendo o host de staging (aplicação por hostname). Se não existir, crie, com bypass para paths de webhook.

### 2. Migrations reproduzíveis

Se a Fase 01 apontou diferenças:

1. Gere uma migration `0000_baseline` (ou a próxima numeração), que leve um banco vazio ao estado exato de produção.
2. Marque a baseline como já aplicada em produção e staging, sem executá-la lá. Use o mecanismo da ferramenta (tabela de controle do Drizzle/Prisma). Mostre o SQL e peça confirmação (R6).
3. Repita o teste da Fase 01, item E: banco vazio + migrations deve ser idêntico a produção.

### 3. Segredos no histórico Git

Para cada credencial VIVA encontrada no histórico:

- Liste ao André qual credencial rotacionar e onde (painel/serviço). A rotação é feita por ele ou com seu OK explícito, uma por vez, validando a Odontobox após cada uma.
- Reescrever o histórico (`git filter-repo`) é OPCIONAL e só com confirmação. Rotacionar é o que realmente resolve.
- Adicione `gitleaks` como pre-commit hook e como passo no CI.

### 4. Manifesto da própria Odontobox

Crie `infra/manifest.json` da Odontobox (formato de `infra/runbook/templates/manifest.example.json`) com os recursos REAIS e os nomes atuais (R10). Ele documenta a Odontobox no mesmo formato dos novos apps.

### 5. Higiene do repositório

- `.env.example` completo, com todos os nomes do inventário e sem valores.
- `.gitignore` cobrindo `.dev.vars*`, `.env*` (exceto `.env.example`), `.wrangler/`, `.open-next/`.
- Branches mortas: apenas liste. Remover só com OK.

---

## Validação

- Deploy SOMENTE em staging (pelo fluxo atual da Odontobox). Rode o checklist de regressão:
  - login;
  - criar e editar registro principal;
  - upload/download de arquivo;
  - envio de e-mail (para a allowlist);
  - conexão WhatsApp QR em instância de teste;
  - evento de agenda Google;
  - webhook Meta de teste.
- Produção só recebe o merge após o André dizer "OK produção fase 02".
- Depois do deploy em produção: health check, logs sem erro novo por 30 min e uptime dos containers Evolution inalterado.

## Saídas

- PR `chore/dup-saneamento`.
- `infra/manifest.json` (Odontobox).
- `infra/reports/odontobox/fase-02.md`: o que foi corrigido, credenciais rotacionadas (nomes + fingerprints novos), resultado das migrations e pendências.

## Critérios de saída

- [ ] Nenhum recurso compartilhado entre produção e staging da Odontobox.
- [ ] Banco vazio + migrations ≡ produção.
- [ ] Nenhuma credencial viva no histórico sem rotação.
- [ ] **PARE e aguarde "OK fase 02".**
