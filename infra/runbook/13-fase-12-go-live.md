# FASE 12 — Go-live em produção

**Onde executar:** repositório do novo app.
**Modo:** Plan mode. Leia `infra/runbook/01-REGRAS-GLOBAIS.md`. Toda ação em produção exige "OK produção" do André.

---

## 1. Checklist pré-go-live (tudo ✅ antes do merge em `main`)

- [ ] Fase 11 aprovada, com 100% dos testes ✅.
- [ ] Secrets de `production` gravados e fingerprints diferentes dos de `stg` (Fase 10).
- [ ] Sentinela `({slug}, production)` na branch `production` do Neon.
- [ ] `evo-{slug}-prod` saudável e hostname `wa.{slug}.com.br` respondendo atrás do Access.
- [ ] Google:
  - projeto de produção configurado;
  - status da verificação registrado.
  - Se ainda pendente: OK para operar com até 100 usuários de teste, ou para adiar o recurso de agenda via feature flag.
- [ ] Meta:
  - App Review submetido/aprovado;
  - WABA e número de produção aprovados.
  - Recursos sem aprovação ficam DESLIGADOS por feature flag.
- [ ] Páginas legais revisadas (sem `[REVISAR JURÍDICO]` pendente).
- [ ] Access em `/admin*` de produção.
- [ ] Rate limit/WAF de produção ativos.
- [ ] DMARC dos subdomínios de e-mail sem falhas há pelo menos alguns dias.
- [ ] Observabilidade:
  - projeto Sentry (ou equivalente) de produção;
  - notificações da Cloudflare (erros de Worker, Hyperdrive) para o e-mail do André.
- [ ] Neon: retenção de histórico/PITR de `production` igual ou maior que a da Odontobox.
- [ ] Plano de rollback escrito (seção 3).

## 2. Execução

1. PR `staging` → `main`. O CI roda `audit:isolation` e os testes.
2. Merge → `deploy-prod.yml` aguarda a aprovação do André no GitHub Environment.
3. Após a aprovação, o deploy roda: migrations guardadas (`--expect-env production`), build, deploy e smoke test.
4. Certificado de `{slug}.venn360.com` ativo; `curl -I` → 200/302 esperado.
5. **Primeiro tenant interno** ("Venn360 – interno"):
   - cadastro;
   - e-mail transacional real;
   - conexão WhatsApp QR com número interno;
   - evento de agenda;
   - webhook Meta (se aprovado).
6. Verifique de novo, em produção, os itens W3 e D3 da Fase 11: instâncias e objetos aparecem só nos recursos `prod` do novo app.

## 3. Rollback

- **Código:** `wrangler rollback --env production` (versão anterior), ou revert do merge + novo deploy.
- **Banco:** migrations do go-live devem ser apenas as já existentes. Se houver migration nova, ela precisa ser compatível com a versão anterior do código (expand/contract). Para restaurar, use PITR/branch de restauração do Neon. Nunca restaure a partir de outro app.
- **Evolution:** container `prod` independente. Parar o container (com "confirmo") não afeta outros apps.

## 4. Pós go-live (48 h)

- Monitore logs (`IDENTITY_MISMATCH`, 5xx, falhas de webhook), consumo de RAM da VPS e e-mails rejeitados.
- Política permanente registrada no README: sem cópia de dados de produção para homologação (R2).
- Mova os segredos de `~/.venn360-secrets/{slug}/` para o gerenciador de senhas e apague a pasta local (com "confirmo").

## Saídas

- `infra/reports/{slug}/fase-12.md`: horário do deploy, versão, evidências, status das aprovações pendentes e incidentes.

## Critérios de saída

- [ ] Produção no ar, smoke test verde, tenant interno funcional.
- [ ] Odontobox sem impacto (health, logs, containers).
- [ ] **PARE e aguarde "OK fase 12".**
