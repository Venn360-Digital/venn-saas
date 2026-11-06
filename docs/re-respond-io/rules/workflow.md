# Rules: Workflow

### R-012 Workflows começam do zero ou de uma biblioteca de templates por categoria
- Given o módulo Workflows (Growth+)
- When o usuário cria um workflow
- Then pode "Começar do Scratch" (builder vazio) ou "Iniciar com um modelo" e escolher na galeria por categoria (Auto-Resposta, Roteamento e Atribuição, Processos de Negócio, Supervisão e Relatórios, Meta CTC Ads, TikTok Ads); alguns templates exigem plano superior ("Upgrade")
- Evidence: [obs EV-010]
- Feature: F-063 · Screen: S-007

### R-013 Um workflow é 1 gatilho + até 100 steps encadeados; publicar o ativa
- Given o builder de workflow
- When o usuário monta o fluxo
- Then há exatamente 1 nó Gatilho (com Condições e Variáveis de gatilho, e opção "Acionar uma vez por contato") seguido de até **100 steps** (Enviar mensagem, Fazer pergunta, Atribuir, Ramo, Atualizar campo/tag/lifecycle, Fechar, Comentar, Pular, Data/Hora, Esperar, CAPI...); o workflow fica **Draft** até **Publicar**, que o ativa
- Evidence: [obs EV-014]
- Feature: F-060, F-062 · Screen: S-007

| Probe | Input | Result | Evidence |
|---|---|---|---|
| Categorias | galeria | 6 categorias; ~37 templates | [obs EV-010] |
| Gating | — | templates "Upgrade"; trigger Webhook = PRO | [obs EV-010] [obs EV-014] |
| Criar | "Começar do Scratch" | modal Nome+Descrição → builder; status Draft | [obs EV-014] |
| Step config | add "Enviar mensagem" | Canal + Tipo + conteúdo + resposta por canal + ramo de falha | [obs EV-014] |
| Max steps | — | Etapas N/100 | [obs EV-014] |
