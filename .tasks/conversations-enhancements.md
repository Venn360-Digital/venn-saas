# Conversations Module Enhancements

## Overview
Implement 5 enhancements to the conversations inbox module.

## Features

### Phase 1: Backend Infrastructure
- [ ] **DB Migration**: Add `lastReadAt` to conversations + enable Supabase Realtime replication
- [ ] **Webhook: messages.update** handler for delivery status (sent→delivered→read)
- [ ] **Webhook: presence.update** handler for typing indicators
- [ ] **API: Send typing presence** endpoint for outbound typing indicator

### Phase 2: Frontend Realtime
- [ ] **Supabase Realtime subscriptions** replace polling intervals
- [ ] **Unread count** based on lastReadAt + mark-as-read on conversation open
- [ ] **Typing indicator** UI (inbound + outbound)
- [ ] **Message delivery status** checkmarks (✓ ✓✓)
- [ ] **Pagination** scroll-up to load older messages

## Technical Decisions
- Use Supabase Realtime channels (postgres_changes) instead of polling
- `lastReadAt` on conversation determines unread count
- Typing indicator uses Supabase Broadcast channel (ephemeral, no DB storage)
- Message pagination: 30 msgs initial, cursor-based load more
