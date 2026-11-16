# FASE 13 — Retrospectiva do piloto e execução do Conecta360

**Onde executar:** primeiro no repositório do Stagent360 (retrospectiva), depois de acordo com cada fase.
**Modo:** normal. Leia `infra/runbook/01-REGRAS-GLOBAIS.md`.

---

## Parte A — Retrospectiva do piloto (Stagent360)

1. Leia todos os relatórios `infra/reports/stagent/fase-*.md` e liste:
   - desvios do roteiro e suas causas;
   - passos que faltaram ou ficaram ambíguos;
   - travas que dispararam (e se dispararam corretamente);
   - tempo real por fase;
   - pendências abertas (aprovações Google/Meta etc.).
2. Proponha alterações concretas nos arquivos do runbook (diff por arquivo) e aplique após "aprovado". O runbook atualizado deve ficar igual nos repositórios da Odontobox e do Stagent.
3. **Proteção cruzada:** confirme que `infra/fingerprints/stagent.json` está no repo da Odontobox e que a auditoria roda no CI dela.

## Parte B — Conecta360

1. **Capacidade da VPS:** com os containers do Stagent já rodando, reavalie a RAM (como no item F7 da Fase 01). Se não couber, PARE e decida com o André antes da Fase 08.
2. **Zona `conecta.com.br`:** confirme que existe na conta Cloudflare (hostnames do Evolution). Se não existir, use o fallback da convenção, com OK do André.
3. **Variáveis do Conecta360:**
   ```
   REPO_NOVO       = Venn360-Digital/conecta360
   NOME_COMERCIAL  = Conecta360
   SLUG            = conecta
   HOST_PROD       = conecta.venn360.com
   HOST_STG        = homolog.conecta.venn360.com
   EVO_HOST_PROD   = wa.conecta.com.br
   EVO_HOST_STG    = stg-wa.conecta.com.br
   EMAIL_FROM_PROD = noreply@mail.conecta.venn360.com
   EMAIL_FROM_STG  = noreply@mail-stg.conecta.venn360.com
   SUPPORT_EMAIL   = suporte@conecta.venn360.com
   ```
4. **Origem da clonagem:** a Odontobox (base comum), não o Stagent. O Stagent já tem regras de negócio próprias.
5. **Lista proibida do Conecta:** `infra/fingerprints/` do repo do Conecta deve conter `odontobox.json` **e** `stagent.json`.
6. Execute as Fases 05 → 12 com essas variáveis, respeitando os checkpoints. A Fase 09, Parte A, deve começar logo no início, por causa das aprovações.
7. **Fechamento:** adicione `infra/fingerprints/conecta.json` aos repositórios da Odontobox e do Stagent (PRs separados). Assim, os três repositórios proíbem mutuamente os recursos uns dos outros.

## Estado final esperado

| | Odontobox | Stagent | Conecta |
|---|---|---|---|
| Repositório | próprio | próprio (upstream só leitura) | próprio (upstream só leitura) |
| Workers | prod + stg | prod + stg | prod + stg |
| Neon | projeto próprio, 2 branches | idem | idem |
| R2 / Hyperdrive / KV / Queues | por ambiente | por ambiente | por ambiente |
| Evolution Go | 2 containers | 2 containers | 2 containers |
| Google / Meta | projetos e apps próprios | idem | idem |
| Lista proibida | stagent + conecta | odontobox + conecta | odontobox + stagent |

## Saídas

- `infra/reports/stagent/fase-13-retro.md`.
- Runbook atualizado.
- Relatórios `infra/reports/conecta/fase-05..12.md`.
