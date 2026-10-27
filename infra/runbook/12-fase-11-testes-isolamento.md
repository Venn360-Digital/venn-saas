# FASE 11 — Testes de isolamento e homologação

**Onde executar:** repositório do novo app. Os testes rodam contra **homologação** (`homolog.{slug}.venn360.com`).
**Modo:** normal. Testes que exigem ação humana (celular, consoles) devem ser pedidos ao André, passo a passo. Leia `infra/runbook/01-REGRAS-GLOBAIS.md`.

---

## Objetivo

Provar com evidências, e não por suposição, que o novo app:
1. funciona;
2. não toca em nenhum recurso da Odontobox (ou de outro app);
3. não mistura homologação com produção.

## Matriz de testes

Registre cada teste em `infra/reports/{slug}/fase-11.md` com: ID, passo, resultado esperado, resultado obtido, evidência (saída, print ou log) e status ✅/❌.

### Identidade e travas

| ID | Teste | Esperado |
|---|---|---|
| I1 | `smoke-identity` em homologação | todos os campos conferem com o manifesto |
| I2 | `migrate-guarded --expect-slug {slug} --expect-env stg` usando a URL do banco de **staging da Odontobox** (credencial de leitura) | **aborta** sem alterar nada |
| I3 | `migrate-guarded --expect-env production` com as credenciais de staging do novo app | **aborta** |
| I4 | `npm run audit:isolation -- --strict` | passa |
| I5 | Grep, no bundle gerado (`.open-next/`), por cada entrada de `infra/fingerprints/odontobox.json` | 0 ocorrências |

### Autenticação e cookies

| ID | Teste | Esperado |
|---|---|---|
| A1 | Cadastro, login, criação de organização (tenant), convite de membro | funciona |
| A2 | `Set-Cookie` no login | nome com prefixo `{slug}`, **sem `Domain=`**, `Secure`, `HttpOnly`, `SameSite` adequado |
| A3 | Cookie de homolog apresentado ao host de produção do novo app e ao host da Odontobox | não autentica |
| A4 | Login Google (se usado) | tela de consentimento mostra o **projeto de homologação do novo app** |

### Dados e arquivos

| ID | Teste | Esperado |
|---|---|---|
| D1 | Criar registros principais | gravados na branch `staging` do projeto Neon do novo app (conferir via MCP Neon) |
| D2 | Contagem de tabelas e linhas do banco da Odontobox antes e depois da bateria (leitura) | sem variação atribuível ao teste |
| D3 | Upload e download de arquivo | objeto existe em `{slug}-stg-files`; a mesma chave NÃO existe em nenhum bucket da Odontobox nem em `{slug}-prod-files` |

### E-mail

| ID | Teste | Esperado |
|---|---|---|
| E1 | E-mail para endereço da allowlist | chega de `noreply@mail-stg.{slug}.venn360.com`, com SPF/DKIM `pass` no cabeçalho |
| E2 | E-mail para endereço fora da allowlist | não é enviado; log registra o descarte |
| E3 | E-mail para `suporte@{slug}.venn360.com` | chega à caixa definida; MX do apex `venn360.com` intacto (`contato@venn360.com` continua recebendo) |

### WhatsApp QR (Evolution Go)

| ID | Teste | Esperado |
|---|---|---|
| W1 | Criar conexão pelo app → QR exibido → André lê com celular de teste | instância `{slug}-stg-*` conectada SOMENTE em `evo-{slug}-stg` |
| W2 | Enviar e receber texto e mídia | mensagem aparece no app de homologação. O webhook chega ao host de homologação (logs do Worker `stg`) |
| W3 | Listar instâncias dos containers da Odontobox e de `evo-{slug}-prod` (leitura) | nenhuma instância de teste lá |
| W4 | Chamada ao Evolution sem service token / sem API key | negada |
| W5 | Uptime dos containers da Odontobox | sem reinício desde a Fase 08 |

### Integrações

| ID | Teste | Esperado |
|---|---|---|
| G1 | Conectar Google Calendar e criar, editar e apagar evento | consentimento com marca do novo app (homolog); evento na agenda de teste |
| M1 | Webhook Instagram, Messenger e WhatsApp Cloud API (test app) | evento chega ao host de homologação e é processado |
| M2 | Webhook com assinatura inválida | 401/403, nada processado |
| X1 | Demais integrações (pagamento etc.) em sandbox | eventos de webhook chegam à homologação |

### Infraestrutura e borda

| ID | Teste | Esperado |
|---|---|---|
| C1 | Acesso anônimo a `homolog.{slug}.venn360.com` | bloqueado pelo Access |
| C2 | Paths de webhook | acessíveis sem Access, protegidos por assinatura |
| C3 | Rate limit em `/api/auth/*` (rajada controlada) | bloqueia acima do limite |
| C4 | Crons de homologação executam | sem efeito externo (logs com `SIMULATE_EXTERNAL`) |
| C5 | Queues: produtor e consumidor | mensagens processadas pelo Worker `stg` |

### Regressão da Odontobox

| ID | Teste | Esperado |
|---|---|---|
| O1 | Health de produção e staging da Odontobox durante e após a bateria | OK |
| O2 | Logs da Odontobox (últimas 24 h) | sem `IDENTITY_MISMATCH` e sem aumento de erros |

## Regras

- Qualquer ❌ em I*, D2, D3, W3, W5 ou O* é **bloqueante**: PARE, registre e não tente "consertar rápido" em produção.
- Corrija via PR → homologação → repetir o teste.

## Critérios de saída

- [ ] 100% dos testes ✅, com evidência.
- [ ] Relatório completo.
- [ ] **PARE e aguarde "OK fase 11".**
