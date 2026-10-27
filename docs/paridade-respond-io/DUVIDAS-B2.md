# Dúvidas e decisões do desenvolvimento do B2 (Broadcast)

## Estado da implementação (2026-10-27)

Construído e verificado por `tsc` (0 erros), ESLint (limpo), `check:paridade`
(T-011 🟡), `check:trabalhos`, `check:filas` (parte de cron) e `prebuild`. **Não**
exercitado em runtime: o workerd não roda nesta máquina e não há banco local — a
fila `broadcast`, o cron e o envio real precisam de staging/CI. Nada foi deployado
(deploy é pelo GitHub/merge, seu).

Feito, por fase: **0** nav + gating (`maxBroadcastRecipientsPerMonth`, `canBroadcast`);
**1** modelos `ContactList`/`ContactListMember`/`BroadcastList` + rotas `/api/marketing/lists` + tela Listas;
**2** `sendTemplate`/`listTemplates` no provedor Meta + sync + `/api/marketing/templates` + tela Templates;
**3** modelos `Broadcast`/`BroadcastRecipient` + fila `broadcast` + fan-out com ritmo + `/api/marketing/campaigns(+/[id]/send)` + telas lista/nova/detalhe;
**4** cron `broadcast-dispatch` (agendamento) + recibos de status no webhook da Meta.

**Pendências conhecidas (não bloqueiam o fluxo):**
- **Vista Calendário** das campanhas — só a Tabela + filtro de status foi feita.
- **Seleção manual de contatos** na criação de lista — hoje a lista nasce de filtro
  (etiqueta/origem/estado/busca); a API aceita `contactIds`, falta o seletor na tela.
- **Status `failed` por webhook** da Meta — o ack normalizado só modela sent/delivered/read;
  falha de envio é capturada no momento do disparo, não por recibo posterior.
- **Provisionar no deploy** a fila `odontobox-broadcast` e sua DLQ (a config já declara).


Registro vivo das decisões tomadas sozinho (rotina) e das dúvidas que precisam da
tua palavra. Nenhuma delas me parou — segui com o default marcado **[decidi]** e
deixo explícito para você reverter se discordar. As marcadas **[precisa decidir]**
mudam o resultado e valem revisão antes de produção.

## Decisões tomadas (rotina)

1. **[decidi] Fila própria `broadcast`.** Fan-out e envio em fila separada, não na
   `whatsapp-outbound` (evita bloqueio do atendimento em tempo real). Exige
   provisionar a fila e a DLQ no deploy (a config já declara; a Cloudflare cria a
   DLQ sozinha).
2. **[decidi] Envio só por linha `whatsapp_business` conectada.** O QR fica fora por
   construção (filtro na seleção da linha e no fan-out). Linha QR nem aparece como
   elegível.
3. **[decidi] Template obrigatório.** A campanha exige um `WhatsAppTemplate` aprovado;
   sem ele não sai do rascunho. Não há texto livre em broadcast.
4. **[decidi] Conversa por destinatário, sem reabrir arquivada.** O envio grava a
   mensagem numa conversa aberta do contato naquela linha se existir; senão cria uma
   nova `active`. **Não reabre** conversas `closed` em massa (evita poluir "Em
   espera"). Uma resposta posterior do paciente cai no fluxo normal de inbound.
5. **[decidi] Opt-out respeitado.** Pula contatos com `autoMessagesPausedAt`.
6. **[decidi] Gating por `PlanLimits`.** Novo teto `maxBroadcastRecipientsPerMonth`;
   consumo abate a mesma contagem de mensagens do plano.
7. **[decidi] Throttle por `atrasoSegundos` escalonado** no fan-out (campo
   `throttlePerMin` por campanha, default conservador 30/min).

## Dúvidas abertas [precisa decidir]

- **D1. Preço/categoria do template.** O disparo de categoria MARKETING tem custo por
  mensagem (BR-001). Não modelei cobrança por mensagem de broadcast além de abater
  `maxMessages`. Confirmar se o crédito de IA (resposta do agente) e a mensagem de
  broadcast devem sair da mesma franquia ou de contadores separados.
- **D2. Throughput da WABA.** O `throttlePerMin` default (30) é conservador. O tier
  real da conta na Meta define o teto seguro — confirmar para calibrar.
- **D3. Listas dinâmicas vs. estáticas.** Implementei lista **estática** (membros
  congelados) populável por filtro de pacientes. Dúvida: você quer lista **dinâmica**
  (reavaliada no disparo)? Deixei o campo `filter`/`kind` no schema preparado, mas o
  disparo hoje usa os membros congelados.
- **D4. Unificar seleção com `consultarPacientes`.** A população da lista por filtro usa
  uma consulta enxuta própria (workspace+etiqueta+origem+estado+opt-out), não o
  `consultarPacientes` inteiro (que é paginado e carrega escopo de atendente). Para
  listas, o gestor vê tudo. Confirmar se precisa do escopo fino.
- **D5. Agendamento recorrente.** O plano previa só agendamento único (`scheduledAt`).
  Recorrência (ex.: toda segunda) não foi modelada.
- **D6. Janela de 24h × template.** Template aprovado dispensa a janela de 24h — então
  não bloqueei por janela. Se você quiser permitir também **texto livre** a quem
  respondeu nas últimas 24h, isso é um caminho adicional não previsto no plano.

## Limitações de validação (ambiente)

- O workerd não roda nesta máquina (ver CLAUDE.md): não dá para exercitar a fila
  `broadcast` nem o cron localmente. Provei por `tsc` (typecheck) e pelo harness
  `check:paridade`. O envio real e o fan-out precisam de staging/CI.
- Os MCPs de Prisma/Supabase/Vercel não autenticaram nesta sessão; migração aplicada
  como arquivo SQL no padrão do repo (`prisma/migrations`), não via MCP.
