# Screens

Rotas observadas na navegação principal em 2026-10-25 (space 487766). Padrão de URL: `/space/:spaceId/<área>`; IDs substituídos por `:id`. Evidência observacional detalhada por tela entra em `screens/S-###-*.md` no deep dive.

| ID | Screen | URL pattern | Entry points | Features | File |
|---|---|---|---|---|---|
| S-001 | Dashboard (Painel) | /space/:id/dashboard | Nav lateral | F-006, F-080 | screens/S-001-dashboard.md |
| S-002 | Onboarding | /space/:id/onboarding | Nav lateral, "Checklist de onboarding" | F-001..F-006 | screens/S-002-onboarding.md |
| S-003 | Inbox / Messages | /space/:id/inbox · /space/:id/inbox/:conversationId | Nav lateral | F-010..F-020, F-038 | screens/S-003-inbox.md |
| S-004 | Contacts | /space/:id/contact | Nav lateral | F-082 | screens/S-004-contacts.md |
| S-005 | AI Agents | /space/:id/ai-agents | Nav lateral (criação também via Inbox) | F-004, F-030..F-040 | screens/S-005-ai-agents.md |
| S-006 | Broadcasts | /space/:id/broadcast | Nav lateral | F-050..F-053 | screens/S-006-broadcast.md |
| S-007 | Workflows | /space/:id/workflows | Nav lateral | F-060..F-068 | screens/S-007-workflows.md |
| S-008 | Reports | /space/:id/reports | Nav lateral | F-054, F-081 | screens/S-008-reports.md |
| S-009 | Settings (Workspace) | /space/:id/settings/:section | Nav lateral (engrenagem); ex.: /settings/lifecycle | F-002, F-003, F-005, F-037, F-083, F-084, F-085 | screens/S-009-settings.md |

Sub-rotas de Settings **observadas** (slugs reais) [obs EV-004]: `general`, `users`, `teams`, `channels` (+ `channels/connect/all`), `integrations`, `growth_widgets`, `contact_fields`, `lifecycle`, `conversations`, `snippets`, `tags`, `ai-assist`, `ai-prompts`, `calls`, `files`, `contact-import`, `data-export`.
