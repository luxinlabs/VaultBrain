# VaultBrain Hackathon Update

_Last updated: May 16, 2026_

## 1. Token Optimization Lab

- Rebuilt the token optimizer with research-backed techniques (LLMLingua, Selective Context, LongLLMLingua, RECOMP, AutoCompressor).
- Added the dedicated **Token Lab** view with side-by-side comparisons and automated mode recommendations.
- Button state now resets whenever the lab opens, so the "Run comparison" action is always clickable.
- Documented the full pipeline in [`Docs/token-optimization.md`](./token-optimization.md).

## 2. Collaboration Surfaces

### 2.1 Team Session Page

- New session UI (🧑‍💻 view) allows partners and analysts to pick an entity and activate pre-built skills (VC criteria, Hog scan, competitive map, timeline, warm paths, etc.).
- Realtime chat transcript and shared session notes keep everyone aligned.
- Added inline **Delete** controls to clear a session’s entity and start fresh.

### 2.2 Collab Pad

- Markdown-based research pad that supports `@agent` mentions (`@hog`, `@gbrain`, `@scanner`, `@analyst`, `@timeline`).
- Mention popup on `@` offers autocomplete; right rail shows responses per agent.
- Preview mode renders headings, todos, and mention highlights.

### 2.3 Instruction Guide

- New guide page explains workflows (scan, note drop, collaboration, agent usage, token lab), roles, keyboard shortcuts, and available agents.

## 3. Knowledge Graph Workflows (GBrain)

- Frontend fetches `/api/pages` to hydrate nodes/links from the SQLite-backed graph.
- Selecting a node fetches detail (timeline, signals, contributors) and enriches the sidebar.
- Persist helpers (`persistNode` / `persistLink`) save new data back into GBrain with frontmatter metadata (`type`, `title`, `tags`).
- Added per-entity edit/delete controls in the sidebar; deletes cascade via the new backend `DELETE /api/pages/:slug` endpoint.

## 4. GStack Integration Surface

- Agent chat (right column) uses stubbed responses today but mirrors the intended GStack conversation entry point.
- Quick-ask buttons and the session skill cards are structured so they can call real GStack skills once wired.
- Token Lab is the first step toward cost-aware routing before prompts reach GStack.

## 5. The Hog (Live Web Intelligence)

### 5.1 Backend plan

- `scanWebsite` now first builds a text query from the company’s domain and runs Hog’s `POST /api/v1/companies/search` (structured metadata + signals), then falls back to the scraper for supplemental signals.
- All signals are normalized and deduped, and we derive VC Investment Criteria (market, traction, team, PMF, moat, funding) straight from the Hog signal payload—no more Google fallback.
- Helpers `coerceArray()` + `dedupSignals()` shield us from API shape drift (`results[]`, `items[]`, etc.).

### 5.2 Frontend workflow

- The Hog input still offers the **mode toggle** (company vs. people search). Plain-text queries hit `/api/hog/search/{companies|people}` while full URLs run the enriched scan described above.
- Scan responses now include `investmentInsights`, so the VC Investment Criteria tiles are fully populated even when the local summary lacks those keywords.
- Signals from Hog feed directly into the timeline list (same schema as GBrain entries) so “Timeline” and “Signals” panes no longer show “Not found” after a scan.
- Search results preview component shows the top results returned by Hog before importing them.

## 6. Next Opportunities

1. Cache token comparisons per hash to make the lab instantaneous for repeated tests.
2. Replace prompt-based edit/delete confirmations with inline modals for richer metadata editing.
3. Wire session skills and Collab Pad mentions to actual GStack tools for live reasoning.
4. Log optimization stats in `integrationLayer.getOptimizationStats` to quantify savings per workspace.
