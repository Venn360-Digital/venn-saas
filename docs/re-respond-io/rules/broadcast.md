# Rules: Broadcast

### R-011 Broadcast tem ciclo de status e duas visualizações
- Given o módulo Broadcasts (Growth+)
- When o usuário gerencia transmissões
- Then cada broadcast tem status **Rascunho → Agendado → Em progresso → Concluído** (ou **Falhou**); a lista filtra por esses status e alterna entre **Tabela** e **Calendário**; a criação começa por um nome interno + rótulos opcionais
- Evidence: [obs EV-009]
- Feature: F-050, F-053 · Screen: S-006

| Probe | Input | Result | Evidence |
|---|---|---|---|
| Status | filtros | Rascunho/Agendado/Em progresso/Concluído/Falhou | [obs EV-009] |
| Criar | Novo broadcast | modal nome(interno)+rótulos → Criar | [obs EV-009] |
