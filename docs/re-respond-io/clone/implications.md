# Implications for the clone

## Copy
Reproduzir o comportamento (não os assets — clean-room).

| Area | Item | Why | Refs |
|---|---|---|---|
| Inbox | Inbox unificado 3 painéis + filtros por atribuição + timeline (mensagens+atividades) | padrão esperado do mercado | S-003, R-006 |
| Lifecycle | Funil + perda, etapa padrão/"venda fechada", inbox automática por estágio | organiza o atendimento ao redor do funil | R-003, R-004 |
| IA | AI Agent com templates (Receptionist/Sales/Support), instruções, knowledge sources, AI Skills, modo Teste seguro | núcleo do produto; diferencial do segmento | S-005, R-009, R-010 |
| Workflows | Builder visual + biblioteca de templates por categoria (auto-resposta, round robin, menus de chat, consentimento) | acelera adoção | S-007, R-012, E-014 |
| Dados | API interno rico (`/api/v2`) + público para integrações; cobrança por MAC | flexibilidade + modelo de preço replicável | api/endpoints.md, SRC-017 |
| Design | Sistema de tokens semântico (equivalente ao "DLS"), tema claro/escuro, Inter | consistência e manutenção | design/tokens.md |

## Avoid

| Area | Item | Why | Refs |
|---|---|---|---|
| Trial | Trial de 7 dias estrangula a avaliação de features gated | fricção de adoção | B-001 |
| IA | Latência de 10–15s do agente | percepção de lentidão | B-002 |
| Acessibilidade | Muitos controles sem rótulo acessível | a11y fraca; oportunidade de melhorar | S-002/S-003 (unlabeled) |
| Hidden writes | Abrir conversa marca lida; surveys gravam preferência sem aviso claro | previsibilidade | topics/hidden-writes.md |

## Improve

| Area | Item | How | Refs |
|---|---|---|---|
| Segurança | Obter **SOC 2** (respond.io só tem ISO 27001 público) | moat enterprise no BR/US | BR-003 |
| Brasil | LGPD nativo: DPA PT-BR, residência de dados (AWS sa-east-1), retenção configurável, consentimento no fluxo | confiança e venda enterprise local | BR-002, template "Solicitar consentimento" (EV-010) |
| Pagamentos | Pix/boleto no billing e pagamento-no-chat (fase 2) | expectativa local | BR-004 |
| IA | Reduzir latência percebida (streaming/otimista) e ampliar AI Skills | melhor que o original | B-002, E-016 |
| Acessibilidade | Rótulos ARIA, foco visível, teclado completo | diferencial e conformidade | S-002/S-003 |
