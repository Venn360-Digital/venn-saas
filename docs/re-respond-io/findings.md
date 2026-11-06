# Findings

## Problems

| ID | Finding | Severity | Where | Evidence |
|---|---|---|---|---|
| B-001 | Trial curta (7 dias) limita janela para estudar features gated (AI Agent, Workflows, Broadcasts) | médio | conta | [obs EV-001] |
| B-002 | AI Agents com latência típica 10–15s declarada como limitação conhecida | baixo | AI Agent | [doc SRC-007] |
| B-003 | Na trial, envio/agendamento de Broadcast é bloqueado (só "broadcast teste") | médio | Broadcast | [obs EV-015] |
| B-004 | Não há "marcar como não lida" — abrir uma conversa a marca como lida de forma irreversível | baixo | Inbox | [obs EV-007] |

## Strengths

- **SOC 2 ausente** no respond.io (só ISO 27001 público): oportunidade de moat se o clone obtiver SOC 2 para o segmento enterprise. [doc SRC-019] [doc SRC-020]
- Estrutura de rotas limpa e previsível (`/space/:id/<área>`), favorável a reimplementar navegação. [obs EV-002]
- Modelo de cobrança por **MAC** ("pague pelos contatos com quem você fala") é diferenciador replicável. [doc SRC-017]
- Stack de IA multi-provider (OpenAI + Mistral + Vertex embeddings + ElevenLabs voz) indica arquitetura de agente + RAG + voz. [doc SRC-022]
