# Relatório — Fase 02 (Saneamento da Odontobox360)

**Data:** 2026-10-27 · **Branch:** `chore/dup-saneamento` · **Base:** `main`.

Contexto: a Fase 02 é plan-mode e só executa os itens que a Fase 01 marcou. Com a autorização ampla do André (seguir até o fim, sem parar), executei **o subconjunto seguro e reversível** nesta branch/PR e deixei o **item pesado (#1, isolar staging)** e as **limpezas em produção** prontos como plano/fila — porque mudam produção (R1 "OK produção") ou são build de infra que afeta a conta inteira.

## Feito nesta branch (seguro, reversível)
1. **`infra/manifest.json` da Odontobox** (item #4) — recursos reais, nomes atuais (R10), com `_isolation` marcando honestamente o que é compartilhado entre prod e staging.
2. **Gitleaks no CI** (`.github/workflows/gitleaks.yml`): PR confere o diff da PR; push/manual varre o histórico; falha o job se achar segredo. **Pre-commit** em `.githooks/pre-commit` (`gitleaks protect --staged`), ativável com `git config core.hooksPath .githooks`.
3. **Higiene de repo** (item #5): `.gitignore` já cobria `.env*`/`.wrangler/`/`.vinext/`; acrescentei `.dev.vars*` e `.open-next/` por completude. `.env.example` já estava completo (Fase 01).

## Itens que a Fase 01 tornou desnecessários
- **#2 Migrations baseline:** a Fase 01-E deu **IDÊNTICO** (banco vazio + migrations ≡ produção). Não há diferença para reconciliar; **nenhuma baseline a criar**.
- **#3 Rotação de segredos:** histórico **limpo** (6 falsos positivos). **Nada a rotacionar.** (O gitleaks entra só como prevenção, acima.)
- **Cron "12 vs 13":** **não é drift.** `src/lib/cron/agenda.ts` documenta que `cronsParaWrangler()` reduz a **doze** gatilhos porque duas rotinas caem no mesmo horário UTC. 12 ativos é o correto.

## Item #1 — isolar staging da Odontobox (PLANO; aguarda sua decisão)
A Fase 01-H achou que a Odontobox **não tem staging isolado**: a branch Neon `staging` é separada, mas **Worker, filas, DO, R2, secrets, Evolution, e-mail e Access são de produção** (previews `pr-N` efêmeros). Todos são achados **críticos**. Isolar de verdade é um build de infra considerável, e aqui há uma decisão sua antes de eu executar:

**Opção A — Construir staging isolado completo agora** (fiel ao runbook):
- Worker `odontobox-stg` (custom domain `homolog.odontobox.venn360.com`), filas `odontobox-stg-*` + DLQs, DO próprios, R2 `odontobox-stg-public`/`-private`, secrets próprios, **allowlist de destinatários** (`OUTBOUND_ALLOWLIST`) para e-mail/WhatsApp, crons em modo simulado (`SIMULATE_EXTERNAL=true`), Access em `homolog.odontobox.venn360.com` com bypass de webhook, e um Evolution de staging (contêiner próprio — no box de staging compartilhado da Fase 08). Atualizar a branch Neon `staging` (hoje atrás de produção) com `migrate deploy`.
- Custo: trabalho alto + recursos novos na conta; parte das escritas Cloudflare pode ser barrada pelo classificador (sua máquina).

**Opção B — Não investir em staging da Odontobox agora; levar o isolamento direto para os apps novos** (recomendada):
- A Odontobox está em produção e o objetivo é **duplicar**. Os apps novos já nascem com par prod/stg isolado por desenho (R3/R9, Fases 06–10). Construir um staging completo para a Odontobox legada é esforço que não acelera a duplicação.
- Mitigação mínima imediata (barata): manter previews como hoje (sem tocar produção) e **aplicar as migrations faltantes na branch Neon `staging`** para ela deixar de ficar atrás de produção.

**Minha recomendação: Opção B** — mitigar o drift da branch `staging` e levar o isolamento real para os apps novos. Mas é decisão sua; se quiser a Opção A, eu monto o plano detalhado de recursos.

## Limpezas em produção (enfileiradas — exigem "OK produção fase 02")
Nenhuma alterei (R1/R20). Uma por vez, validando a Odontobox após cada:
1. **`RESEND_API_KEY` órfão** no Worker `odontobox` — remover do Worker (não está no `cloudflare.config.ts`; Resend desativado) e **retirar a chave no painel do Resend** (parece viva). É sua a retirada no Resend; a remoção do Worker é um deploy de produção.
2. **Schema `neon_auth` (9 tabelas)** no banco de produção — provisionamento do Neon Auth **não usado** (o app tem Better Auth em `public`). `DROP SCHEMA neon_auth CASCADE` é destrutivo (R6) → só com "confirmo". Baixa urgência.
3. **Better Auth `cookiePrefix`/host-only (T5)** — hoje a Odontobox é o único host sob `venn360.com`; quando `stagent`/`conecta` entrarem, cookie sem prefixo pode vazar sessão entre produtos. É mudança de código (vai no deploy), mas **desloga todo mundo uma vez** (muda o nome do cookie). Recomendo aplicar junto da Fase 10 (quando os vizinhos existirem), não agora.
4. **VPS sem backup/snapshot** e **role read-only no Neon** inexistente — itens de higiene (Fases 08/pontual).

## Validação
Não houve deploy (nada de produção alterado; os deliverables são repo/CI). O checklist de regressão de staging roda quando/se a Opção A for aprovada.

## Saídas
- PR `chore/dup-saneamento` (este).
- `infra/manifest.json` (Odontobox).
- Este relatório.

## Critérios de saída (estado)
- [~] "Nenhum recurso compartilhado prod×stg": **documentado**, não resolvido — aguarda decisão A/B.
- [x] Banco vazio + migrations ≡ produção (já era, Fase 01-E).
- [x] Nenhuma credencial viva no histórico sem rotação (não há credencial viva).
- Prossigo (autorização "não parar"); as limpezas de produção ficam na fila de "OK produção".
