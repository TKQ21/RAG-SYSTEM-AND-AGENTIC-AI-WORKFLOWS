
## Goals
1. **Accuracy fix** — "40-50 age group" must return **74.32%**, and "about Ratan Tata" must return the full multi-paragraph biography (born 1937, Parsi family, Cornell, Harvard, $50M gifts, etc.).
2. **Scale to 10,000-page documents** without timeouts or memory blowups.
3. **UI overhaul** — remove login, add cinematic intro (lightning flash → animated "RAG System & Agentic AI Workflow" title → fade into app), fix chat-history delete bug, premium dark SaaS look (Linear/Stripe/Notion vibe).

---

## Part 1 — Retrieval correctness (backend)

Root cause of wrong answers:
- **Numeric mapping bug**: For Power BI tables the model still aligns the wrong index. Fix by switching from "trust the LLM" to **deterministic table parsing** in the edge function: detect label arrays + value arrays in a chunk, build an index→value map server-side, and inject it as structured context (`"40-50": 74.32%`) so the LLM cannot misalign.
- **Biography truncation**: Current ±1 neighbor expansion is not enough when the "About" section spans 8–12 chunks. Fix by:
  - When the top hit's section heading matches the query intent (`about`, `biography`, `early life`, etc.), pull **all chunks of that section** (same `document_id`, contiguous `chunk_index` range bounded by the next heading), not just ±1.
  - Detect section boundaries during ingestion and store `section_title` per chunk.

Changes:
- `process-document/index.ts`: tag each chunk with `section_title` (detected from headings/font size cues) and `section_id`.
- `agent-chat/index.ts`:
  - New `extractTablePairs(chunk)` helper → emits deterministic `label:value` pairs for the LLM.
  - New `expandSection(topHit)` → returns full section when query is biographical/descriptive.
  - Bump retrieval to 25 chunks, then dedupe by section.
- Migration: add `section_title TEXT`, `section_id INT` to `document_chunks` + index.

## Part 2 — 10,000-page document support

- **Streaming ingestion**: process PDF page-by-page in a queue; never load the whole file into memory.
- **Background job**: `process-document` enqueues into a new `ingestion_jobs` table; a new `process-document-worker` edge function picks pages in batches of 20, embeds, inserts, and updates progress %.
- **Chunk batching**: embed in batches of 50 with concurrency 4 to stay under Gemini rate limits.
- **Status UI**: progress bar per document ("Processed 3,420 / 10,000 pages").
- Migration: `ingestion_jobs(document_id, total_pages, processed_pages, status, error)`.

## Part 3 — UI overhaul

Remove auth gate; app opens straight into the experience.

**Intro sequence (≈3.5s, skippable on click)**
```text
[0.0s] Black screen
[0.3s] Lightning bolt SVG flashes across screen (white → electric blue), screen-shake
[0.8s] "RAG System" letters drop in, glow blue
[1.4s] "& Agentic AI Workflow" slides in below, glow purple
[2.5s] Hold
[3.0s] Whole title fades + scales out
[3.5s] Main app fades in
```
Built with Framer Motion; uses `sessionStorage` so it only plays once per session.

**Main app layout**
```text
┌─────────────┬────────────────────────────┬──────────────┐
│  Sidebar    │  Chat (centered, max-3xl)  │  Insights    │
│  collapsible│  - bubbles user vs AI      │  collapsible │
│  Chats      │  - typing dots             │  - sources   │
│  History    │  - copy/regen/like         │  - reasoning │
│  Documents  │  - markdown + code blocks  │    log       │
│  Settings   │  Sticky input + chips      │              │
└─────────────┴────────────────────────────┴──────────────┘
```

**Style tokens (`index.css` + `tailwind.config.ts`)**
- Background: `#0a0a0f` → `#12121a` gradient
- Surfaces: charcoal `#1a1a24` with backdrop-blur and 1px border `hsl(240 10% 20%)`
- Accent: electric blue `hsl(220 90% 65%)` + violet `hsl(265 85% 70%)` glow
- Radius 14px everywhere, soft shadows `0 8px 32px hsl(220 90% 50% / 0.08)`
- Font: Inter via Google Fonts, tabular-nums for timestamps

**Chat history delete bug** — current `deleteConversation` removes from local state but the active conversation isn't reset; fix by clearing `activeId` when deleted and ensuring DB row + messages are cascaded.

**Files**
- New: `src/components/IntroAnimation.tsx`, `src/components/AppShell.tsx`, `src/components/InsightsPanel.tsx`, `src/components/ChatBubble.tsx`, `src/components/QuickPrompts.tsx`
- Edit: `src/pages/Index.tsx` (mount intro then shell), `src/App.tsx` (drop auth route guards), `src/index.css`, `tailwind.config.ts`
- Delete: `src/pages/Auth.tsx` and any `ProtectedRoute` wrapper

---

## Technical details

- **Migration order**: (a) add columns + jobs table → (b) backfill `section_title` for existing chunks via one-shot SQL using regex on `content` → (c) deploy edge functions.
- **Re-index existing docs**: provide a "Re-index" button per document that re-runs ingestion with the new section detector. Existing chunks stay queryable in the meantime.
- **Auth removal safety**: keep `user_roles`/RLS in DB but switch policies on `documents`/`chunks`/`messages` to allow anon read+write scoped by an anonymous client-generated `session_id` stored in localStorage. (User explicitly asked to remove the login panel.)
- **Framer Motion** added via `bun add framer-motion`.
- **Performance**: virtualize message list with `react-virtuoso` once a conversation exceeds 100 messages.

---

## Deliverables / acceptance
1. Query "40–50 age group में heart disease %" → answer **74.32%** with citation.
2. Query "Ratan Tata ke about section" → full bio paragraph (Bombay 1937 → Cornell → Harvard → $50M gifts).
3. Upload a 10k-page PDF → progress bar advances, no timeout, queryable when done.
4. App loads with lightning intro, no login screen, polished dark UI, working sidebar collapse, working chat-history delete.

Confirm and I'll execute in this order: migration → backend functions → UI.
