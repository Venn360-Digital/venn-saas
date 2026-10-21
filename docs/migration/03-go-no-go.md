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
| storage | **BLOQUEADO** | mídia de paciente é clínica, e clínico não tem provedor aprovado; as 3 chamadoras degradam |
| webhooks | **NOT RUN** | — |
| tempo real | **PARCIAL** | lógica provada em `check:tempo-real`; os Durable Objects só no CI (o `workerd` não roda nesta máquina) |
| IA / bloqueio de PHI | **NOT RUN** | — |
| POC Evolution Go | **PARCIAL** | publicada e medida em 2026-10-21; 3 de 7 critérios fechados, 4 barrados pela ativação da licença — ver [`11`](11-poc-evolution-go.md) |
| `check:canal` | **PASS** | 27 provas — janela do reinício, recusa de hibernar, vigia |
| `check:trabalhos` | **PASS** | 60 provas — as costuras das filas, quem lança e quem não lança |
| processadores de fila | **PASS** | os 8 ligados; 13 crons atrás do despacho |
| backup / restore | **NOT RUN** | — |

## Pendências que nasceram desta fase

| # | Pendência | Gravidade |
| --- | --- | --- |
| 1 | **Falha de entrega de e-mail é invisível.** O gancho `sendResetPassword` roda em segundo plano: o que ele lança não chega à resposta HTTP, e `requestPasswordReset` devolve 200 mesmo quando o envio falha. Hoje o único sinal é uma linha de log. Precisa de contador na vigia de integrações — a mesma que já existe para o Asaas — antes do lançamento | **média** |
| 2 | `users.hashedPassword` ficou obsoleta e **não** foi removida: enquanto o Supabase Auth ainda atender, apagá-la seria apagar o caminho de volta. Migração própria, depois do corte | baixa |
| 3 | Confirmação de e-mail está **desligada** (`requireEmailVerification: false`), coerente com o cadastro aberto para homologação. Entra junto com o portão de cadastro | baixa |
| 4 | Dependências: `next` com CVE crítico (HTTP request smuggling em rewrites) e `handlebars` crítico via LangChain. Atualizar antes do corte | **média** |
| 5 | Branch protegida no Neon exige plano superior (`HTTP 422`) | baixa |
| 6 | **A licença do Evolution Go precisa de ativação humana, e entra no caminho crítico do corte.** Contêiner novo responde 503 `LICENSE_REQUIRED` e nenhum QR nasce. A licença é gratuita; o ato não é automatizável (painel web). Caminho pronto: `/manager` sai pelo Worker, sem o túnel SSH que a VPS exigia | **alta** |
| 7 | **O Evolution Go no pooler do Neon não está provado.** `/server/ok` fica verde sem banco — é o próprio sintoma de produção —, e a licença barrou antes de a migração de esquema rodar. Se o pooler não servir, o endpoint direto traz de volta o vazamento de conexões, com teto **mais baixo** que o dos 100 da VPS | **média** |
| 9 | **Storage clínico fecha o porte das filas.** Mídia que o paciente manda, nota de voz do agente e foto de perfil são clínicas, e clínico sai por URL assinada de validade curta que **não se persiste** — a coluna de hoje guarda URL. Falta aprovar o provedor **e** trocar a coluna por referência (`provedor`/`bucket`/`chave`), com o endereço assinado na leitura | **alta** |
| 11 | **O plano do Neon precisa subir para Launch, e por DOIS projetos, não um.** O Neon documenta que "applications that maintain long-lived connections **or scheduled jobs (like cron tasks)** can prevent your compute from scaling to zero, keeping it active 24/7". O Evolution prende por conexão; **a aplicação prende pelo cron `* * * * *`** (`activity-reminders` + varredura da outbox). Os dois dão 180 CU-hora/mês contra 100 de franquia, e ao esgotar o compute é **suspenso** — indisponibilidade total, no meio do mês, em silêncio. ~US$ 38/mês no Launch, ou ~US$ 29 restringindo o cron a horário comercial | **alta** |
| 12 | **O cron de cada minuto é o que custa no projeto da aplicação, e é evitável.** Restringir a `* 10-23 * * *` (UTC) derruba de 180 para 97,5 CU-hora — cabe na franquia free, ou US$ 10,33 no Launch. O `activity-reminders` transmite para atendentes **conectados**, e às 3h não há nenhum; o `reminderSentAt` fica intocado de propósito, então o poll do Topbar continua mostrando. Decisão de produto do André | média |
| 10 | **Os ajustes do agente não são segredos e podem divergir em silêncio.** Sete das nove variáveis de `src/trabalhos/ambiente.ts` têm padrão: se a VPS tiver valor diferente, o Worker sobe sem erro e usa o padrão. Conferir antes do corte — ver o aviso em `02-runbook.md` A.5 | **média** |
| 8 | O batimento da licença manda o **IP do servidor**, e em Containers ele muda a cada subida. O tier comunidade declara não ter limite de instância, mas isso é dependência de terceiro que não se afirma lendo documentação | baixa |

## Riscos abertos
Ver [`00-open-decisions.md`](00-open-decisions.md) Parte 1. Os quatro vermelhos:
build local impossível, storage clínico sem provedor aprovado, recursos da
Cloudflare não provisionados. O quarto — "Evolution Go sem POC" — sai da lista:
a POC rodou, e o risco que ela carregava (scale-to-zero) está resolvido. No
lugar dele entra um risco menor e de outra natureza: a **ativação da licença**,
que é um ato humano no caminho crítico.

## Custo a aprovar
*(a estimar quando os recursos forem dimensionados)*

| Recurso | Custo previsto |
| --- | --- |
| Workers Paid | US$ 5/mês — já contratado |
| Neon (SP, 0,25–2 CU) | a medir; 19 MB cabe no plano baixo |
| R2 | arredondamento com 5,7 MB |
| Magalu `br-se1` | R$ 0,10/GiB + R$ 0,10/GiB de saída, requisição grátis |
| Queues, Durable Objects | a estimar por volume |
| Containers (Evolution Go) | **medido**: `lite` sempre ligado, US$ 1,74 por workspace pareado/mês (US$ 21 a dez, US$ 108 a cinquenta). Workspace sem pareamento dorme e não cobra |
| Neon — compute sem suspender | **US$ 19,34/mês, e exige o plano Launch.** 182,5 CU-h/mês contra 100 de franquia free *por projeto*: no free o compute é **suspenso por volta do dia 16**. E se as bases do Evolution ficarem no projeto da aplicação, quem é suspenso é o sistema, não só o WhatsApp |

## Checklist do gate

- [ ] backup conferido: arquivo, tamanho, `pg_restore --list` e **restauração
      testada em base isolada**
- [ ] ensaio de cutover cronometrado **< 2 h**
- [ ] provedor de storage clínico **aprovado**
- [ ] evidência de que o R2 contém **apenas** público/não sensível
- [ ] IA bloqueia PHI/PII identificável, e usa BYOK sem Unified Billing
- [x] POC do Evolution Go: o critério **6** está resolvido — recusar o sono é
      caminho documentado, e o arranque a frio de 25–40 s mostra que é
      obrigatório, não opcional. **Não** é preciso hospedar o Evolution Go fora
      da Cloudflare
- [ ] licença do Evolution Go **ativada** no destino (ato do André) e os
      critérios 1, 2, 3 e 5 fechados com um aparelho de teste
- [ ] o dump do corte inclui `evogo_auth` e `evogo_users` — passos 5b e 8b do
      runbook. **Sem isso o WhatsApp de toda clínica cai depois do DNS**
- [ ] VPS, volumes, dumps e credenciais **íntegros** e não removidos
- [ ] crons convertidos para UTC e conferidos
- [x] os 8 processadores de fila ligados, e os 13 crons com despacho
- [ ] provedor de storage clínico aprovado **e** a coluna de URL trocada por
      referência — é o que falta para o porte das filas estar completo
- [ ] os sete ajustes com padrão conferidos contra a VPS (`02-runbook.md` A.5)
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
