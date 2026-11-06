# Rules: Lifecycle

### R-003 Estágios de lifecycle têm dois grupos: funil e perda
- Given o editor Settings > Ciclo de vida
- When o usuário configura estágios
- Then há dois grupos — "Etapas do ciclo de vida" (funil) e "Etapas de perda" (loss); o funil tem uma etapa `padrão` (primeira) e uma de `Venda Fechada`/closed-won (🏆); cada grupo tem "Adicionar etapa" (até 20 no total)
- Evidence: [obs EV-006]
- Feature: F-003 · Screen: S-009

### R-004 Cada etapa do funil cria uma caixa de entrada padrão; etapas de perda não
- Given a configuração de lifecycle
- When uma etapa é do grupo funil
- Then "Uma caixa de entrada padrão será criada no módulo Caixa de entrada" para ela; etapas de perda não geram caixa de entrada
- Evidence: [obs EV-006]
- Feature: F-003 · Screen: S-009

### R-005 Ocultar etapas não apaga dados
- Given o toggle "Mostrar/ocultar etapas do ciclo de vida"
- When desativado
- Then as etapas somem da inbox e dos módulos de contatos, mas os dados do contato permanecem ("Seus dados de contato permanecem seguros e inalterados")
- Evidence: [obs EV-006]
- Feature: F-003 · Screen: S-009

| Probe | Input | Result | Evidence |
|---|---|---|---|
| Estágios default | abrir editor | New Lead(padrão)/Hot Lead/Payment/Customer(venda fechada) + Cold Lead(perda) | [obs EV-006] |
| Caixa de entrada por etapa | — | funil cria inbox padrão; perda não | [obs EV-006] |
