# E-014 Workflow
Product term: Workflow · Parent: none · Status: stub (sem API pública — detalhar no deep dive F-060..F-068)

## Fields (hipótese a observar — Q-010)
| Field | Type | Required | Default | Constraints or enum | Source |
|---|---|---|---|---|---|
| id | number | sim | — | workflowId aparece na mensagem | [doc SRC-028] |
| name | string | sim | — | — | [doc SRC-010] |
| trigger | WorkflowTrigger | sim | — | evento inicial (enum abaixo) | [doc SRC-010] |
| steps | WorkflowStep[] | sim | — | grafo de passos | [doc SRC-010] |
| status | enum | sistema | Draft | **Draft / Published** | [obs EV-014] |
| maxSteps | const | — | 100 | "Etapas: N / 100" (máx 100 steps) | [obs EV-014] |
| triggerOnce | boolean | não | false | "Acionar uma vez por contato" | [obs EV-014] |

### Triggers (enum) [doc SRC-010] [obs EV-014]
**Conversa aberta** · **Conversa fechada** · **Campo de contato atualizado** · **Etiqueta de contato atualizada** · **Atalho** (Shortcut, do Inbox) · **Webhook de entrada** (POST externo — **PRO/Advanced+**) · **Anúncios Click-to-Chat** (Meta) · **TikTok Messaging Ads** · **Manual** (via "Trigger Another Workflow"/AI Agent) · **Lifecycle Updated** · **Call Ended**. **Sem triggers agendados por tempo.** 1 trigger por workflow; o nó Gatilho tem **Condições de gatilho** (filtros) e **Variáveis de gatilho**. [obs EV-014]

### Config de Step (observado — ex. "Enviar uma mensagem") [obs EV-014]
Cada step tem painel de config próprio. "Enviar uma mensagem": **Canal** (padrão "Último canal interagido"), **Tipo de mensagem** (Texto/...), conteúdo, **Adicionar Resposta de Canal** (variante por canal), avançado "Adicionar ramo de mensagem com falha". Se o canal não existe ou a mensagem falha, o contato sai do fluxo.

### Configurações e ações do workflow [obs EV-014]
Settings (engrenagem): permitir que usuários interrompam o fluxo para um contato; definir condições de saída. Menu de Ações na lista: Publicar · Editar Nome/Descrição · Abrir no Construtor · **Clonar** · **Exportar workflow** · Configurações · **Apagar**.

### Categorias de template observadas [obs EV-010]
Auto-Resposta · Roteamento e Atribuição · Processos de Negócio · Supervisão e Relatórios · Anúncios Click-to-Chat da Meta · TikTok Messaging Ads. ~37 templates (boas-vindas/ausência/menus de chat; round robin/por idioma/turnos; escalação/consentimento/resumo de chamada; CSAT→Sheets/warehouse; CAPI Meta; TikTok). Alguns marcados "Upgrade" (plano superior).

### Steps conhecidos [doc SRC-010]
Send a Message · Ask a Question · Assign To · Branch · Jump To · Wait · Date & Time · Update Contact Tag · Update Contact Field · Update Lifecycle · Open/Close Conversation · Add Comment · Trigger Another Workflow · HTTP Request [Advanced+] · Add Google Sheets Row · Send Conversions API Event · Send TikTok Lower Funnel Event · AI Objective (legado).

## Relations
| Relation | Target | Cardinality | On delete | Source |
|---|---|---|---|---|
| mensagens originadas | E-003 Message | 1—N (sender.source=workflow) | — | [doc SRC-028] |
| aciona | E-005/E-006 (Assign To), E-007/E-008/E-009 (update steps) | — | — | [doc SRC-010] |

## Lifecycle
draft → published. Triggers e campos de cada Step a observar no builder.

## System fields
| Field | Set when | Source |
|---|---|---|
| id | ao criar | [doc SRC-028] |

## Rules
- Evitar loops (boa prática) [doc SRC-010] — F-068.

## Not tested
- Lista de triggers; config de cada Step; biblioteca de templates (F-063); condições de Branch.
