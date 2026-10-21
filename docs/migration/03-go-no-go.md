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
| `build` | **NOT RUN** | — |
| build vinext | **BLOCKED** | `workerd` não roda em macOS 12.7.6; só no CI |
| autenticação | **NOT RUN** | Better Auth não implementado |
| multi-tenant | **NOT RUN** | — |
| storage | **NOT RUN** | — |
| webhooks | **NOT RUN** | — |
| tempo real | **NOT RUN** | — |
| IA / bloqueio de PHI | **NOT RUN** | — |
| POC Evolution Go | **NOT RUN** | exige Containers (custo) |
| backup / restore | **NOT RUN** | — |

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

## Parar aqui

**Pedir aprovação explícita antes de:** criar ou alterar recurso pago ·
restaurar ou escrever em base que possa ser produção · migrar sessão real de
WhatsApp ou segredo · publicar em produção · mudar DNS, WAF ou roteamento ·
excluir ou alterar recurso da VPS.

Depois da aprovação, **um item por vez**, confirmando o resultado antes de
avançar.
