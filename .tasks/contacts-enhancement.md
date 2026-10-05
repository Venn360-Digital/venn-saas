# Contacts Module Enhancement Plan

## Features
1. Pagination (20/50/100)
2. Contact History (deals, conversations, messages count)
3. Advanced Filters (tag, source, date range, deal status)
4. CSV Import with preview + duplicate handling
5. CSV Export with filters
6. Custom Fields (text, number, date, select, checkbox) per Workspace

## Phase 1: Database & API Foundation
- [x] Migration: `CustomFieldDefinition` table (workspace-scoped)
- [x] API: `GET/POST/PATCH/DELETE /api/custom-fields`
- [x] API: Update `GET /api/contacts` with pagination, filters, sorting
- [x] API: Update `GET /api/contacts/[id]` with full history data
- [x] API: Update `PATCH /api/contacts/[id]` to handle customFields
- [x] API: `POST /api/contacts/import` (CSV parse + preview + commit)
- [x] API: `GET /api/contacts/export` (CSV download)

## Phase 2: Frontend - Full Page Rewrite
- [x] Full-screen dialog with Tabs (Dados, Histórico, Campos Custom)
- [x] Pagination controls (20/50/100)
- [x] Advanced filter bar (tags, source, date, deal)
- [x] Import modal with CSV preview + column mapping
- [x] Export button wired
- [x] Custom fields editor in contact form
