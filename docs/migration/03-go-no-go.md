# 03 — Gate de produção

> **Estado: NÃO ALCANÇADO.** Este documento se preenche no fim da Fase 5, e as
> Fases 4 e 5 estão em andamento. Está aqui com a estrutura e o que já se sabe,
> para que nada seja esquecido na hora.

## Resumo das mudanças
*(a preencher — por ora, ver `git log migracao/cloudflare-neon`)*

Até 2026-10-21: o cofre foi reconstruído (commit `8d941e3`) e os documentos das
Fases 0–3 foram escritos.

## Testes — placar

`PASS` / `FAIL` / `BLOCKED` / `NOT RUN`. **Nada se declara aprovado sem ter
rodado.**

| Área | Estado | Observação |
| --- | --- | --- |
| `typecheck` | **PASS** | limpo em 2026-10-21 |
| `eslint` | **PASS** | 0 erros, 120 avisos pré-existentes |
| `lint:colors` | **PASS** | — |
| `lint:workspace` | **PASS** | nenhuma rota resolve workspace por conta própria |
| `check:widget` | **PASS** | — |
| `check:cofre` | **PASS** | 14 provas, incluindo adulteração rejeitada |
| `check:neon` | **PASS** | 26 provas contra o Neon São Paulo |
| `check:storage` | **PASS** | 15 provas; ciclo R2 em **SKIP** (falta token de API) |
| `check:auth` | **PASS** | 33 provas contra o Neon |
| `check:filas` | **PASS** | 60 provas — outbox, dedup, fuso dos crons, disciplina de consumo |
| `check:tempo-real` | **PASS** | 30 provas — debounce e protocolo, sem banco |
| `typecheck:cloudflare` | **PASS** | Durable Objects contra os tipos reais da Cloudflare |
| `build` | **NOT RUN** | — |
| build vinext | **BLOCKED** | `workerd` não roda em macOS 12.7.6; só no CI |
| autenticação | **PASS** | cadastro, login, redefinição, troca de senha e criação por administrador, provados em `check:auth` |
| multi-tenant | **NOT RUN** | — |
| storage | **NOT RUN** | — |
| webhooks | **NOT RUN** | — |
| tempo real | **PARCIAL** | lógica provada em `check:tempo-real`; os Durable Objects só no CI (o `workerd` não roda nesta máquina) |
| IA / bloqueio de PHI | **NOT RUN** | — |
| POC Evolution Go | **NOT RUN** | exige Containers (custo) |
| backup / restore | **NOT RUN** | — |

## Pendências que nasceram desta fase

| # | Pendência | Gravidade |
| --- | --- | --- |
| 1 | **Falha de entrega de e-mail é invisível.** O gancho `sendResetPassword` roda em segundo plano: o que ele lança não chega à resposta HTTP, e `requestPasswordReset` devolve 200 mesmo quando o envio falha. Hoje o único sinal é uma linha de log. Precisa de contador na vigia de integrações — a mesma que já existe para o Asaas — antes do lançamento | **média** |
| 2 | `users.hashedPassword` ficou obsoleta e **não** foi removida: enquanto o Supabase Auth ainda atender, apagá-la seria apagar o caminho de volta. Migração própria, depois do corte | baixa |
| 3 | Confirmação de e-mail está **desligada** (`requireEmailVerification: false`), coerente com o cadastro aberto para homologação. Entra junto com o portão de cadastro | baixa |
| 4 | Dependências: `next` com CVE crítico (HTTP request smuggling em rewrites) e `handlebars` crítico via LangChain. Atualizar antes do corte | **média** |
| 5 | Branch protegida no Neon exige plano superior (`HTTP 422`) | baixa |

## Riscos abertos
Ver [`00-open-decisions.md`](00-open-decisions.md) Parte 1. Os quatro vermelhos:
build local impossível, storage clínico sem provedor aprovado, Evolution Go sem
POC, recursos da Cloudflare não provisionados.

## Custo a aprovar
*(a estimar quando os recursos forem dimensionados)*

| Recurso | Custo previsto |
| --- | --- |
| Workers Paid | US$ 5/mês — já contratado |
| Neon (SP, 0,25–2 CU) | a medir; 19 MB cabe no plano baixo |
| R2 | arredondamento com 5,7 MB |
| Magalu `br-se1` | R$ 0,10/GiB + R$ 0,10/GiB de saída, requisição grátis |
| Queues, Durable Objects | a estimar por volume |
| Containers (Evolution Go) | **o item que pode dominar a conta** — depende da política de execução |

## Checklist do gate

- [ ] backup conferido: arquivo, tamanho, `pg_restore --list` e **restauração
      testada em base isolada**
- [ ] ensaio de cutover cronometrado **< 2 h**
- [ ] provedor de storage clínico **aprovado**
- [ ] evidência de que o R2 contém **apenas** público/não sensível
- [ ] IA bloqueia PHI/PII identificável, e usa BYOK sem Unified Billing
- [ ] POC do Evolution Go passou nos 7 critérios — em especial o **6**
- [ ] VPS, volumes, dumps e credenciais **íntegros** e não removidos
- [ ] crons convertidos para UTC e conferidos
- [ ] webhooks da Meta, Asaas e Evolution com as URLs novas anotadas
- [ ] `main` protegida, PR obrigatório, produção com aprovação humana
- [ ] nenhum segredo em commit, log ou artefato de CI
- [ ] `npm run migrar:usuarios --aplicar` rodado, e os 3 links entregues
- [ ] auditoria de segurança (`/security-audit`) executada e achados tratados

## Parar aqui

**Pedir aprovação explícita antes de:** criar ou alterar recurso pago ·
restaurar ou escrever em base que possa ser produção · migrar sessão real de
WhatsApp ou segredo · publicar em produção · mudar DNS, WAF ou roteamento ·
excluir ou alterar recurso da VPS.

Depois da aprovação, **um item por vez**, confirmando o resultado antes de
avançar.
