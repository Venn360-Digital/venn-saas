# Charter: respond.io
Date: 2026-10-25

| Item | Value |
|---|---|
| Goal | Clone funcional do respond.io, reconstruído **a partir do comportamento** (não copiar assets), voltado a "agente de atendimento com IA + módulos auxiliares" — plataforma de conversas omnichannel (WhatsApp-first) com IA de atendimento, inbox de equipe, broadcast e workflows. Stack alvo: **Next.js + TypeScript + Postgres/Neon + Cloudflare Workers**. |
| Requested by | André (andre@venn360.com) |
| Scope | Em ordem de prioridade: **1. Onboarding** — conectar canais, criar negócios (pipes), criar agentes, convidar colegas. **2. Inbox** — chats, chamadas, caixa de entrada de equipe. **3. Agente de IA** — treinamento e base de conhecimento, estágios de ciclo de vida (lifecycle), atribuição de conversas. **4. Broadcast** — transmissão. **5. Modelos de Workflow** — templates, auto-resposta, roteamento e atribuição, processos de negócio, supervisão e relatórios. |
| Out of scope | Marketplace de integrações, billing, mobile. |
| Clone target market | **Brasil.** Segmento assumido: PMEs e agências de atendimento/vendas conversacionais, WhatsApp-first (suporte + vendas via chat). Porte micro a médio. *(Suposição escrita por falta de especificação do segmento exato — ver Q-001.)* |
| Priorities | P1 = as 5 áreas de escopo acima, nessa ordem. Dentro de cada área: core loop primeiro (criar/ver/editar/atribuir conversa; treinar e acionar o agente de IA). P-barreiras Brasil tratadas em paralelo (LGPD, WhatsApp/Meta, Pix, NF-e, SSO/audit, limites e-mail/SMS). |
| Mode | **Não assistido (unattended).** Não perguntar nada até terminar; blocos vão para "Needs human" no STATUS.md; "don't ask" muda o relato, não o que pode ser tocado. |
| Environment level | **L1** — conta trial criada pelo André, logada no perfil Chrome "CLAUDE CODE", sem sessão de produção. Ferramenta: Claude in Chrome nesse perfil. |
| Write authorization | Palavras do usuário: *"Pode criar dados de teste à vontade dentro dela (prefixo [RE], e-mails andre@venn360.com). Nunca envie convites, mensagens, nem mexa em billing, plano ou integrações OAuth."* → Autoriza A2 (dados de teste no L1). **Proibido explicitamente mesmo em L1:** enviar convites, enviar mensagens, billing, plano, conectar integrações OAuth (A5 — já proibido pela skill; reforçado pelo usuário). |
| KB language | Prosa em **português**; rótulos de campo, IDs e nomes de arquivo em inglês (padrão da skill). |
| Terms of service | **URL: https://respond.io/terms-of-service** (Last Updated 2025-01-20) [doc SRC-021]. **Não há cláusula nominal de "reverse engineering"/"decompile"/"disassemble", nem cláusula "no-compete"/"benchmark".** O que existe: §1.7 nega direito de acesso ao código-fonte; §1.2 proíbe copiar/criar derivados do *conteúdo*; §6.4 proíbe "reproduce, duplicate, copy, sell, resell or exploit any portion" do serviço. **Implicação:** recon de superfície pública não viola termo nomeado; **copiar UI/assets ou reproduzir "qualquer porção" do serviço é vedado** → reforça o mandato clean-room (reconstruir do comportamento, nunca de assets). Decisão de prosseguir pertence ao André/jurídico — ver **Q-002** e "Needs human" no STATUS. |
