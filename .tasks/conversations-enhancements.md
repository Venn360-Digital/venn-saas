# Conversations Module Enhancements

## Overview
Implement 5 enhancements to the conversations inbox module.

> **O desenho do tempo real mudou (2026-10-24).** Este plano é de fevereiro de
> 2026 e previa escutar o banco direto da tela. Esse mecanismo saiu junto com a
> plataforma anterior: hoje o evento é gravado numa outbox na mesma transação do
> dado e publicado num Durable Object. O registro é
> `docs/migration/06-realtime-design.md` — os itens abaixo valem, o meio não.

## Features

### Phase 1: Backend Infrastructure
- [ ] **DB Migration**: Add `lastReadAt` to conversations
- [ ] **Webhook: messages.update** handler for delivery status (sent→delivered→read)
- [ ] **Webhook: presence.update** handler for typing indicators
- [ ] **API: Send typing presence** endpoint for outbound typing indicator

### Phase 2: Frontend Realtime
- [ ] **Realtime subscriptions** replace polling intervals
- [ ] **Unread count** based on lastReadAt + mark-as-read on conversation open
- [ ] **Typing indicator** UI (inbound + outbound)
- [ ] **Message delivery status** checkmarks (✓ ✓✓)
- [ ] **Pagination** scroll-up to load older messages

## Technical Decisions
- Push events instead of polling (outbox + Durable Object, não escuta do banco na tela)
- `lastReadAt` on conversation determines unread count
- Typing indicator is broadcast-only (ephemeral, no DB storage)
- Message pagination: 30 msgs initial, cursor-based load more
