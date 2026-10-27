# FASE 09 — Integrações externas (Google, Meta e demais)

**Onde executar:** repositório do novo app, branch `chore/dup-integracoes`. A maior parte do trabalho é feita pelo André nos consoles do Google e da Meta. O Claude Code prepara tudo, gera os valores e confere.
**Modo:** normal. Leia `infra/runbook/01-REGRAS-GLOBAIS.md`.
**Antecipe:** a Parte A pode e deve começar logo após a Fase 01, em paralelo. As aprovações de Google e Meta levam de dias a semanas e são o caminho crítico do cronograma.

---

## Princípio

Cada produto tem projeto/app próprio em cada plataforma, e o staging usa projeto/app de teste separado. Nenhum client ID, app secret, verify token, número ou WABA é compartilhado com a Odontobox nem entre ambientes.

## Parte A — Preparação (Claude Code gera; André executa nos consoles)

Gere `infra/integracoes/{slug}.md`: um checklist passo a passo com TODOS os valores a preencher, por ambiente.

### A1. Google (Calendar + login Google, se usado)

| Item | Produção | Homologação |
|---|---|---|
| Projeto Google Cloud | `{repo}-prod` | `{repo}-stg` |
| Status da tela de consentimento | Em produção → **verificação** | **Testing** (até 100 usuários de teste, sem verificação) |
| Nome do app / logo | Stagent360 | Stagent360 (Homolog) |
| Domínio autorizado | `venn360.com` | `venn360.com` |
| Página inicial / Privacidade / Termos | `https://stagent.venn360.com`, `/privacidade`, `/termos` | idem em homolog |
| APIs habilitadas | Google Calendar API (+ outras do inventário G) | idem |
| Escopos | EXATAMENTE os do inventário G (não amplie) | idem |
| OAuth Client (Web) – origens JS | `https://stagent.venn360.com` | `https://homolog.stagent.venn360.com` |
| Redirect URIs | todas as rotas de callback do código (liste-as a partir do inventário A4/A6) | idem com host de homolog |
| Usuários de teste | — | e-mails informados pelo André |

- **Verificação:** `venn360.com` precisa estar verificado no Google Search Console na conta do André. O vídeo de demonstração do uso do escopo do Calendar é exigido. Gere o roteiro do vídeo.
- Os segredos (client secret) vão para `~/.venn360-secrets/{slug}/google-{env}.env`. Peça que o André cole lá, nunca no chat.

### A2. Meta (Instagram, Messenger, WhatsApp Cloud API)

| Item | Produção | Homologação |
|---|---|---|
| App | `Stagent360` (tipo Business), no Business Manager da Venn360 | **Test App** vinculado ao app de produção |
| Produtos | Messenger, Instagram, WhatsApp (conforme o inventário G) | idem |
| Callback de webhook | `https://stagent.venn360.com/api/webhooks/<path>` | `https://homolog.stagent.venn360.com/api/webhooks/<path>` |
| Verify token | novo (gerado, R8) | novo (gerado, R8) |
| App Secret | do app de produção | do test app |
| Permissões / App Review | as do inventário G (ex.: mensagens do Instagram, mensagens de Página) | não exige review |
| WhatsApp | **WABA e número(s) próprios do Stagent360**, nome de exibição aprovado | número de teste fornecido pela Meta |
| Token de acesso | System User dedicado `stagent360-system`, com acesso SOMENTE aos ativos deste app | System User do test app |
| URLs de privacidade, termos e exclusão de dados | páginas do próprio domínio | idem |

- A validação `X-Hub-Signature-256` com o App Secret do ambiente é obrigatória em todos os webhooks Meta. Confirme no código. Se faltar, implemente nesta fase.
- O App Review exige app publicado e acessível. Submeta assim que a Fase 10 publicar o ambiente de produção (pode ser em modo restrito).

### A3. Demais integrações (inventário G)

Para cada uma (pagamento, Sentry, analytics, IA, SMS…): conta/projeto/chave próprio por app. Em `stg`, sandbox ou test mode. Webhooks apontando para o host do ambiente. Gere a linha correspondente no checklist.

## Parte B — Conferência (após o André concluir)

1. Confirme que cada client ID e app ID novo **não** consta em `infra/fingerprints/odontobox.json`.
2. Confira os redirect URIs e callbacks contra as rotas reais do código. Nenhum host de outro app.
3. Registre no manifesto os IDs públicos (client IDs, app IDs, WABA ID, phone number IDs) por ambiente. NUNCA secrets.
4. Atualize `infra/fingerprints/{slug}.json`.
5. Liste o status das aprovações: verificação Google, App Review Meta e nome de exibição WhatsApp. Inclua a data de submissão.

## Saídas

- `infra/integracoes/{slug}.md` (checklist preenchido).
- Manifesto e fingerprint atualizados.
- `infra/reports/{slug}/fase-09.md`.

## Critérios de saída

- [ ] Projetos/apps separados por produto e por ambiente.
- [ ] Segredos apenas em `~/.venn360-secrets/{slug}/`.
- [ ] Aprovações submetidas, ou datas previstas registradas.
- [ ] **PARE e aguarde "OK fase 09".**
