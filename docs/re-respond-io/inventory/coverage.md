# Coverage

Values: `todo`, `partial`, `done`, `blocked`, `n/a`. The work queue is this table, top to bottom (ordem de prioridade P1→P3 por área do escopo).

| Feature | Anatomy | States | Interactions | Rules | Data | Network | Keyboard and a11y | Persistence | Design | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| F-001 Onboarding módulo | done | partial | partial | partial | partial | todo | todo | todo | partial | S-002, R-001; falta estado vazio/completo e teclado |
| F-002 Conectar canais | partial | todo | partial | todo | partial | todo | todo | todo | todo | Catálogo observado (EV-004); OAuth não iniciado (A5) |
| F-003 Configurar Lifecycle | done | partial | partial | done | done | todo | todo | todo | partial | S-009 editor; R-003..R-005; funil cria inbox por etapa |
| F-004 Configurar AI Agents (etapa) | partial | todo | partial | partial | partial | todo | todo | todo | todo | Via builder S-005 |
| F-005 Convidar colegas | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked | Usuário proíbe convites (A5); só documentar UI read-only |
| F-006 Checklist/Copilot | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-010 Lista+chat | partial | partial | partial | done | done | done | partial | partial | todo | S-003; R-006/R-008; envio proibido (não exercitado) |
| F-011 Atribuir/fechar+Closing Notes | partial | partial | todo | done | partial | partial | todo | todo | todo | R-007 (open/pending/close, snooze, auto-close via rede); UI não exercitada |
| F-012 Chamadas no Inbox | todo | todo | todo | todo | todo | todo | todo | todo | todo | Requer canal de voz; provável read-only |
| F-013 Team inbox/Custom Inbox | partial | partial | todo | todo | partial | todo | todo | todo | todo | Estrutura vista (nenhuma criada); funil cria inbox por estágio |
| F-014 Filtros/busca | partial | todo | done | done | done | done | todo | partial | todo | Filtros + conversation/list (R-006) |
| F-015 Comments/colaboradores | todo | todo | todo | todo | todo | todo | todo | todo | todo | Comment só p/ operador; não mencionar terceiros |
| F-016 AI Assist | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-017 AI Prompts | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-018 Sentiment | done | todo | todo | partial | done | todo | todo | todo | todo | IA classifica Positivo/Neutro/Negativo ao fechar; config em Settings>Conversas (EV-017) |
| F-019 Snippets | done | partial | partial | todo | done | todo | todo | todo | todo | E-015 resolvido (nome/ID/mensagem/tópico/arquivo); usado inbox/broadcast/workflow |
| F-020 Command palette | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-030 Criar AI Agent | done | partial | partial | done | partial | todo | todo | todo | partial | S-005; R-009; templates + do zero; draft inativo |
| F-031 Knowledge Sources | partial | todo | todo | todo | partial | todo | todo | todo | todo | Seção no builder + /settings/ai-knowledge-source; config não exercitada |
| F-032 AI Skills | partial | todo | todo | done | partial | todo | todo | todo | todo | 5 skills sugeridas observadas; R-010 |
| F-033 Instructions/Prompts | partial | todo | partial | todo | partial | todo | todo | todo | todo | Instruções + modelos de prompt + Otimizar |
| F-034 Review Instructions | partial | todo | todo | todo | todo | todo | todo | todo | todo | Badge "Não revisado" observado |
| F-035 Test AI Agent | partial | todo | partial | partial | partial | todo | todo | todo | todo | Simulador + contato mock; não executado |
| F-036 Publish AI Agent | todo | todo | todo | todo | todo | todo | todo | todo | todo | Publicar pode ativar auto-resposta: cuidado com canal real |
| F-037 Lifecycle + Transitions Log | partial | todo | todo | partial | partial | todo | todo | todo | todo | Estágios/estrutura via E-009; transitions log ainda não observado |
| F-038 Atribuição de conversas | partial | todo | todo | todo | partial | partial | todo | todo | todo | assigneeUserId/collaboratorUserIds via rede; UI não exercitada |
| F-039 Voice AI Agent | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-040 AI Advanced settings | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-050 Criar/agendar Broadcast | done | partial | partial | partial | done | todo | todo | todo | partial | S-006/EV-015; compositor (segmento/canal/conteúdo); envio gated na trial (B-003) |
| F-051 Segmentação destinatários | done | todo | partial | partial | partial | todo | todo | todo | todo | Via Segmento (combobox) no compositor; tipo de canal específico/último |
| F-052 Message limits | partial | todo | todo | todo | todo | todo | todo | todo | todo | Ritmo "Gradual" observado; limites numéricos não (ver BR-001) |
| F-053 Gerir Broadcast | partial | done | todo | partial | partial | todo | todo | todo | todo | Status Rascunho/Agendado/Em progresso/Concluído/Falhou; views Tabela/Calendário |
| F-054 Relatórios Broadcast | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-060 Builder workflow | done | partial | done | done | partial | todo | todo | todo | partial | S-007/R-013; canvas observado (aba 1º plano); máx 100 steps; Draft→Publicar |
| F-061 Triggers | done | todo | partial | done | partial | todo | todo | todo | todo | 11 triggers (doc+UI, EV-014); condições/variáveis/once; Webhook=PRO |
| F-062 Steps | done | partial | partial | partial | partial | todo | todo | todo | todo | Paleta completa + config de step exemplo (Enviar mensagem) EV-014 |
| F-063 Templates workflow | done | partial | partial | done | partial | todo | todo | todo | todo | 6 categorias, ~37 templates (EV-010); R-012 |
| F-064 Assign To | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-065 Steps de dados | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-066 HTTP/Sheets/Conversions | todo | todo | todo | todo | todo | todo | todo | todo | todo | Advanced+: pode estar gated no plano Growth |
| F-067 AI Objective legado | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-068 Evitar loops | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
| F-080 Dashboard | partial | todo | todo | todo | todo | todo | todo | todo | todo | Anatomia inicial observada (EV pendente mascarado) |
| F-081 Reports | partial | todo | todo | todo | partial | todo | todo | todo | todo | 11 relatórios catalogados (EV-011); gráficos não detalhados |
| F-082 Contacts | partial | todo | partial | todo | partial | todo | todo | todo | todo | Views por lifecycle + segmentos default (EV-012); detalhe de contato não aberto |
| F-083 Workspace Settings | partial | todo | partial | partial | partial | todo | todo | todo | todo | Users/papéis+permissões (EV-016), lifecycle, snippets; demais sub-páginas parciais |
| F-084 Channels catálogo | partial | todo | partial | todo | partial | todo | todo | todo | todo | Catálogo + categorias observados (EV-004) |
| F-085 Growth Widgets | todo | todo | todo | todo | todo | todo | todo | todo | todo | |
