# VaultBrain Project Overview

_Last updated: May 16, 2026_

## Mission

Unify deal sourcing, research, and collaboration for VC teams by connecting three pillars:

1. **GBrain** – the persistent knowledge graph of companies, founders, timelines, and signals.
2. **GStack** – the AI execution layer (agents, skills, conversations) where insights are generated.
3. **The Hog** – live web intelligence that keeps data fresh with signal scans and enrichments.

## Architecture Highlights

- **Backend:** Bun/Express API with SQLite storage. Modules include authentication, GBrain CRUD, Hog connector, token optimizer, and integration layer.
- **Frontend:** Vite + React app with ForceGraph visualization, agent chat, token lab, session/guide/collab views.
- **Data Flow:** Users add notes or scans → nodes persist via `/api/pages` with metadata → links stored via `/api/links` → Hog connector enriches entities → token optimizer compresses context before GStack.
- **Skills Layer:** Every skill (session cards, Collab Pad `@mentions`, right-rail chat actions) routes through the integration layer so we can both read from GBrain and write any new intelligence back.

### Skills layer: storing + extracting context

1. **Request envelope** – The UI packages each skill invocation with:
   - `skill_id` (e.g., `vc_criteria`, `timeline_recorder`, `hog_scan`).
   - `entity_scope` (node slug, tags, latest signals) pulled from GBrain via `/api/pages/:slug`.
   - `context_window` – token-optimized snippets selected by `tokenOptimizer.optimize()`.
2. **Extraction path (GBrain → GStack):**
   - Integration layer fetches the node, timeline, signals, and adjoining links from SQLite (via `gbrainService.getPageWithDetails`).
   - It shapes the payload into structured messages for the targeted GStack tool (chat completion, ReAct tool, etc.).
3. **Execution (GStack):**
   - For mock mode we echo deterministic text; once wired, responses will come from the corresponding GStack skill endpoint.
   - Responses include `messages`, `structured_insights`, and optional `proposed_links`.
4. **Storage path (GStack → GBrain):**
   - Integration layer decides what to persist:
     - `structured_insights` become timeline entries or signal rows.
     - `proposed_links` call `persistLink`.
     - Free-form summaries are embedded into the page’s Markdown (`persistNode`).
   - Each write includes provenance (`source: gstack_<skill_id>`) so future skills can filter their own outputs.
5. **Feedback hooks:**
   - Session UI and Collab Pad immediately display the stored result, guaranteeing that the same insight is queryable the next time we call a skill.
   - Token optimizer metrics are logged on each run to monitor cost/latency before invoking GStack.

## Key Features (May 2026)

### Knowledge Graph & CRUD

- Graph loads from `/api/pages` on login, filtered by permissions.
- Sidebar lists founders and companies with inline edit ✏️ & delete 🗑 controls.
- Selecting a node fetches detail (timeline, signals, contributors) and shows investment criteria / founder experience.
- Deleting an entity now cascades through links, signals, timeline entries, and assignments via `DELETE /api/pages/:slug`.

### Collaboration Surfaces

1. **Agent Chat:** Quick-ask prompts and free-form questions (currently stubbed, ready for GStack hookup).
2. **Team Session Page:** Live discussion around a selected entity with prepared skills (VC criteria, Hog scan, competitor map, warm paths, timeline recap, etc.) plus shared notes.
3. **Collab Pad:** Markdown editor with `@agent` mentions that trigger simulated agent responses in a side panel.
4. **Instruction Guide:** Walks teams through workflows, roles, shortcuts, and available agents.

### Token Optimization Lab

- Dedicated page for comparing conservative / balanced / aggressive modes.
- Techniques: LLMLingua phrase/filler compression, Selective Context scoring, LongLLMLingua query boosts, RECOMP dedup, AutoCompressor-style passes.
- Button state reset ensures "Run comparison" is always available.
- Documented thoroughly in `Docs/token-optimization.md` and summarized in `Docs/project-update.md`.

### The Hog Integration

- `/api/hog/scan` and `/api/hog/enrich-company` share the `scanWebsite` normalization (handles `%20`, missing protocols, spaces, etc.).
- Person enrichment uses Hog’s `/api/enrichments` endpoint.
- Errors bubble up as 502s with clearer context when the upstream API refuses a URL.

## Tech Stack

| Layer    | Technologies                                                                      |
| -------- | --------------------------------------------------------------------------------- |
| Frontend | React 18, TypeScript, Vite, ForceGraph2D, CSS modules                             |
| Backend  | Bun runtime, Express, SQLite, custom services (gbrain, hog, token optimizer)      |
| Auth     | Email/password via `/api/auth`, JWT stored in localStorage                        |
| Data     | `pages`, `entity_links`, `timeline_entries`, `hog_signals`, `analyst_assignments` |

## Workstreams Going Forward

1. **Wire to real GStack skills** for agent chat, session skill cards, and Collab Pad mentions.
2. **Improve editing UX** (replace prompt dialogs with modals, inline forms, or right-rail editors).
3. **Cache token comparisons** and gather optimization telemetry per workspace.
4. **Automate Hog ingestion** for scheduled re-scans and signal freshness alerts.
5. **Expose analytics** (sourcing velocity, signals by sector, token savings) to the dashboard.

---

For a changelog-oriented view, see `Docs/project-update.md`. For the deep-dive on compression research, see `Docs/token-optimization.md`.
