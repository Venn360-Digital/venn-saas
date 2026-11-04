# Rules: AI Agent

### R-009 Criar AI Agent parte de template ou do zero e nasce como rascunho inativo
- Given o módulo AI Agents (Growth+)
- When o usuário escolhe um template (Receptionist/Sales/Support) ou "Iniciar do zero"
- Then um agente é criado com status "Não revisado" + "Inativo" e abre o editor; só passa a atender após "Publicar" (Cancelar descarta o rascunho)
- Evidence: [obs EV-008]
- Feature: F-030 · Screen: S-005

### R-010 AI Skills definem as ações do agente; o modo Teste não afeta config nem canal
- Given o builder do AI Agent
- When o usuário adiciona Habilidades (Atribuir, Encerrar conversa, Atualizar campo de contato, Atualizar lifecycle, Adicionar comentário)
- Then o agente pode executá-las numa conversa; o simulador de Teste roda com um contato mock e "não afetará a sua configuração" (nem envia a canais reais)
- Evidence: [obs EV-008]
- Feature: F-032, F-035 · Screen: S-005

| Probe | Input | Result | Evidence |
|---|---|---|---|
| Iniciar do zero | clique | cria agente Inativo/Não revisado | [obs EV-008] |
| Cancelar | clique | descarta rascunho (0 agentes) | [obs EV-008] |
| Habilidades sugeridas | — | Atribuir/Encerrar/Atualizar campo/Atualizar lifecycle/Comentar | [obs EV-008] |
