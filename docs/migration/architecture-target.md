# Arquitetura-alvo do OdontoBox360

Estado de referência depois da migração. O que é **decidido** está afirmado; o
que depende de experimento ou aprovação está marcado.

```
                       Internet
                           │
              ┌────────────▼────────────┐
              │  Cloudflare — borda     │  DNS · CDN · TLS · WAF · DDoS
              │  zona venn360.com       │  bot_management: SEM bloqueio de IA
              └────────────┬────────────┘
                           │
        ┌──────────────────▼──────────────────┐
        │  Worker: odontobox360 (vinext)      │  Next 16 · 107 rotas
        │  build e deploy SOMENTE no CI       │  middleware · RSC · server actions
        └──┬─────┬─────┬─────┬─────┬─────┬───┘
           │     │     │     │     │     │
    ┌──────▼─┐ ┌─▼───┐ ┌▼───┐ ┌▼──┐ ┌▼────┐ ┌▼──────────┐
    │ Neon   │ │ R2  │ │ DO │ │Q  │ │ AI  │ │ Container │
    │ SP     │ │ pub │ │    │ │   │ │ GW  │ │ Evo Go POC│
    └────────┘ └─────┘ └────┘ └───┘ └─────┘ └───────────┘
         │                                         │
         │        ┌───────────────────┐            │
         └────────┤ Magalu br-se1     │◄───────────┘
                  │ clínico sensível  │
                  │ PENDENTE DE AVAL  │
                  └───────────────────┘
```

## Camadas

### Borda — Cloudflare
DNS, CDN, TLS, DDoS e WAF na zona `venn360.com`.

**Regra da casa, e vale aqui também:** a borda **não** pode bloquear IA.
Conferir em `/zones/{id}/bot_management` que `ai_bots_protection`,
`crawler_protection` e `ai_training` estejam `disabled`. Se a borda barra,
`robots.txt` é irrelevante — o robô nem chega.

Para o OdontoBox360 isso vale nas páginas **públicas** (marketing, login,
widget). O painel autenticado não é indexável por construção.

### Aplicação — um Worker, vinext
Next.js 16 pelo vinext (recomendação oficial da Cloudflare; OpenNext passa a ser
caminho de manutenção). **Build e deploy só no CI**: `workerd` exige macOS 13.5+
e a máquina do André está em 12.7.6.

### Dados — Neon PostgreSQL, São Paulo
Projeto `odontobox` (`polished-shape-42069569`), `aws-sa-east-1`, PG 18.
Branch `production` (protegida) e `staging`. Endpoint **pooled** para o Worker,
**direto** para migrations. `pgvector 0.8.6` para o RAG. Hyperdrive só se medir
ganho.

### Identidade — Better Auth, biblioteca da aplicação
Sobre o Postgres do Neon. Substitui o Supabase Auth em 59 arquivos.
`src/lib/auth/workspace.ts` **não muda**: a autorização por workspace e papel
continua sendo dela, sobre Prisma.

### Cofre — duas metades  ✅ implementado
| O quê | Onde | Por quê |
| --- | --- | --- |
| 5 segredos de plataforma (Meta, Instagram, Asaas) | **Cloudflare Secrets** | globais, de valor fixo: configuração de implantação |
| Tokens por workspace, segredo gravável | **AES-256-GCM** em `app_secrets` e nos campos de integração | a aplicação precisa gravá-los; a chave fica em Cloudflare Secrets, fora do banco |

`supabase_vault` não existe no Neon. A troca desfez o impasse que o próprio
schema registrava: na VPS não havia onde pôr a chave; na Cloudflare há.

### Arquivos — dois destinos, roteados por classificação
| Classe | Destino | Bucket |
| --- | --- | --- |
| público / não sensível | **R2** | `venn-odontobox360-publico-<amb>` |
| clínico sensível | **Magalu `br-se1`** — *pendente de aval* | `venn-odontobox360-clinico-<amb>` |

R2 **não** garante residência física no Brasil (*Location Hints* são dica), logo
nada clínico vai para lá. No Postgres só `storage_provider`, `bucket`,
`object_key`, classificação e metadados — **nunca URL assinada persistida**.

### Assíncrono
| Peça | Uso |
| --- | --- |
| **Queues** | as 8 filas; retentativa e DLQ |
| **Cron Triggers** | os 13 crons — **em UTC**, convertidos de BRT |
| **Workflows** | só o longo e durável: `rag-index` de documento grande, `billing-reconcile` |
| **Durable Objects** | tempo real, trava distribuída, debounce do `ai-reply` |

### Tempo real — Durable Objects, um por workspace
Escrita no Postgres **não** chega sozinha ao DO: o Neon não publica WAL para a
Cloudflare. Então **tabela `outbox` na mesma transação** → publicador idempotente
→ Queues → DO → fan-out WebSocket. Autorização no handshake, por sessão e
`workspaceId`. Detalhe em [`06-realtime-design.md`](06-realtime-design.md).

### IA — AI Gateway com BYOK
OpenAI para chat/atendimento, Gemini para pesquisa/análise. **Sem Unified
Billing.** Embeddings ficam na OpenAI: os vetores gravados são 1536-d e trocar o
modelo invalida o índice. Só entrada minimizada e anonimizada; identificador de
paciente é **bloqueado**, e a recusa é registrada sem o conteúdo.

### E-mail
Adaptador em `src/lib/email`. **Resend no primeiro corte**; Cloudflare Email
Service depois, quando houver verificação do produto — trocar e-mail no mesmo
corte de banco, auth, filas e storage concentra risco sem necessidade.

### WhatsApp — Evolution Go em Container  ⚠️ POC
Uma sessão por workspace é requisito de produto. O que a POC decide é se um
runtime gerencia várias com isolamento provado, ou se cada uma precisa de
container próprio. O risco real: o componente **já** perde sessão na VPS, onde
nada hiberna.

## O que fica isolado por produto
Worker, banco, secrets, domínio, filas, Durable Objects e buckets. Um
repositório por SaaS. Compartilhável vira pacote quando o **segundo** produto
precisar — não antes.

## Portabilidade preservada
PostgreSQL padrão · migrations versionadas · adaptador S3 nos dois destinos ·
adaptador de IA por tarefa · provedores de integração encapsulados ·
configuração por ambiente. Nenhuma lógica de negócio presa a fornecedor.
