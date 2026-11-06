# Rules: Onboarding

### R-001 O onboarding mostra progresso "N de 4" e destaca o passo atual com CTA
- Given uma conta parcialmente configurada
- When o usuário abre `/onboarding`
- Then vê a saudação com o primeiro nome, o progresso "N de 4" e 4 passos (conectar canais → lifecycle → AI Agents → convidar colegas), com o passo atual exibindo um botão de ação
- Evidence: [obs EV-005]
- Feature: F-001 · Screen: S-002

### R-002 "Conectar canal" abre o catálogo de canais em nova aba (Settings)
- Given a tela de onboarding
- When o usuário clica "Conectar canal"
- Then abre `/space/:id/settings/channels/connect/all` numa nova aba, com o catálogo por categoria (Mensagens comerciais, Chamadas, SMS, E-mail, Chat ao vivo)
- Evidence: [obs EV-005] [obs EV-004]
- Feature: F-002 · Screen: S-002

| Probe | Input | Result | Evidence |
|---|---|---|---|
| Conectar canal | clique | nova aba em /settings/channels/connect/all | [obs EV-005] |
| Catálogo | abrir | 6 categorias; ~10 canais em "Mensagens comerciais" | [obs EV-004] |
