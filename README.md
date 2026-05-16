# VaultBrain

**VaultBrain = Collaborative VC Brain** — a living book that agents read/write while partners simply inspect the compiled truth.

Built for the GStack x GBrain Hackathon | May 16, 2026

---

## What It Does

VaultBrain combines:

- **VaultBrain's persistent memory** for structured entities, timelines, and provenance
- **The Hog's live web intelligence** for autonomous signal intake
- **GStack's agent orchestration** so ingestion/extraction/chat flows are agent-operated instead of manual

### How the brain feels

1. **Drop anything** – pitch decks, emails, meeting notes land in the drop zone. A GStack intake skill cleans the text and extracts founders/companies/signals.
2. **Paste raw text** – the paste box routes messy snippets through the same extraction pipeline.
3. **Ask the brain** – the agent chat (powered by GStack) reasons across everything in GBrain plus fresh Hog signals.
4. **Scan with The Hog** – one click pulls live LinkedIn/news/Reddit signals into the selected entity’s timeline.

This isn’t a CRM where humans type fields. Agents do the reading/writing; partners just watch the VC brain compound knowledge.

### The Gap We Fill

| Feature       | GBrain Today       | Traditional CRM                                   | VaultBrain |
| ------------- | ------------------ | ------------------------------------------------- | ---------- |
| Data entry    | Humans type fields | Agents extract structure from anything dropped in |
| Memory        | Static rows        | Compiled truth + timeline stored in GBrain        |
| Signals       | Manual research    | The Hog scans + writes to entity pages            |
| Collaboration | Per-user lists     | "Brain Book" sidebar shared by the whole firm     |
| Interface     | Forms/tables       | Living book + agent chat                          |

---

## Quick Start

### Prerequisites

- Bun v1.0+ (https://bun.sh)
- Node.js 18+ (for frontend)
- The Hog API key with scan permissions

### 1. Clone & Setup

```bash
cd dealflow-ai

# Backend setup
cd backend
bun install
cp .env.example .env
# Edit .env with your JWT_SECRET, HOG_API_KEY, and seed credentials

# Create SQLite schema
bun run db:setup

# Seed authentication users (no founder demo data)
bun run db:seed

# Start backend
bun run dev
```

### 2. Frontend Setup

```bash
cd ../frontend
npm install
npm run dev
```

### 3. Access

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001
- **Health Check:** http://localhost:3001/health

### Login

The seed script only creates authentication users based on your `.env` values:

- `SEED_PARTNER_EMAIL` / `SEED_PARTNER_PASSWORD` (required)
- `SEED_ANALYST_EMAIL` / `SEED_ANALYST_PASSWORD` (optional)

Set those environment variables before running `bun run db:seed`, then log in with the same credentials from the frontend. No founder/company demo data is stored locally—every search hits The Hog in real-time.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VaultBrain                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    │
│  │   Frontend   │    │   GStack     │    │  The Hog     │    │
│  │   (React)    │◄──►│   Agent      │◄──►│  Connector   │    │
│  │              │    │  Orchestrator│    │              │    │
│  └──────────────┘    └──────────────┘    └──────────────┘    │
│         │                    │                    │            │
│         │                    ▼                    │            │
│         │            ┌──────────────┐             │            │
│         └───────────►│  Shared      │◄────────────┘            │
│                      │  GBrain      │                          │
│                      │  (Postgres)  │                          │
│                      └──────────────┘                          │
│                             │                                   │
│                      ┌──────────────┐                          │
│                      │  Permissions │                          │
│                      │  & Merge     │                          │
│                      │  Engine      │                          │
│                      └──────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### 1. Brain Book Sidebar

- Entities appear automatically after agents process dropped/pasted content
- Provenance badges label which agent/source wrote each fact
- Multi-user by default; assignments still stored in GBrain tables

### 2. Seamless Intake

- Drop zone + paste box feed a GStack intake skill
- Claude extracts structured JSON which we persist via GBrain APIs
- Zero-form data entry: agents write, humans review

### 3. Hog Signal Feeds

- Every entity page has a "Scan with The Hog" button
- Signals write straight into the same timeline used for human notes
- Dream cycle (cron) keeps the brain fresh overnight

### 4. Brain Agent Chat

- Powered by GStack conversation skills
- Queries GBrain for facts, Hog for fresh signals, SQLite for analytics
- Returns natural-language answers with cited provenance

---

## How GBrain, GStack, and The Hog work together

| Component   | What we use it for                                                                                                                                                                                                                     | Where it shows up                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **GBrain**  | Acts as the canonical structured store (pages, timelines, contributors). Every extracted founder/company is written here, and provenance is tracked via the existing contribution tables.                                              | Entity page fields, timeline entries, contributor badges, permission checks.                           |
| **GStack**  | Hosts the intake + conversation skills. Drop/paste events trigger a GStack skill that cleans content, calls Claude for extraction, and writes to the backend. The right-hand “Brain Agent” chat is also a GStack conversation surface. | Drop zone/paste interactions, “Ask the brain” chat box, quick-ask buttons.                             |
| **The Hog** | Provides live web intelligence. Our backend Hog connector calls `/v1/scan` whenever users hit "Scan with The Hog" or during nightly enrichment.                                                                                        | Signal feed inside each entity page, Hog provenance badges, "Signals (30d)" summary in the scanner UI. |

GBrain makes the brain persistent, GStack keeps agents doing the heavy lifting, and The Hog keeps every founder/company page alive with real-world activity.

---

## API Endpoints

### Authentication

```bash
POST /api/auth/login
{
  "email": "alice@dealflow.ai",
  "password": "partner123"
}

GET /api/auth/me
Authorization: Bearer <token>
```

### Live Hog Scan

```bash
POST /api/hog/scan
Authorization: Bearer <token>
{
  "website": "https://company.com"
}

# Response (abridged)
{
  "domain": "company.com",
  "website": "https://company.com",
  "signals": [
    {
      "source": "linkedin",
      "type": "hiring",
      "content": "Company is hiring an ML engineer",
      "timestamp": "2026-05-15T10:00:00Z",
      "engagement": { "likes": 42, "comments": 8 }
    }
  ],
  "summary": { "total_signals": 12 }
}
```

---

## Database Schema

### Core Tables

- `dealflow_users` - User accounts with roles
- `pages` - GBrain pages (extended with user tracking)
- `page_contributions` - Provenance tracking
- `page_permissions` - Access control
- `entity_merges` - Merge history
- `timeline_entries` - Structured timeline data
- `hog_signals` - Cached web intelligence
- `entity_links` - Knowledge graph
- `analyst_assignments` - Analyst access grants
- `dream_cycle_runs` - Enrichment job tracking

### Key Functions

- `can_read_page(slug, user_id)` - Permission check
- `can_write_page(slug, user_id)` - Permission check

---

## Development

### Backend Commands

```bash
bun run dev          # Start dev server
bun run db:setup     # Create SQLite schema
bun run db:seed      # Create auth users from env vars
```

### Frontend Commands

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run preview      # Preview production build
```

### Environment Variables

**Backend (.env):**

```
JWT_SECRET=your-secret-key
HOG_API_KEY=your-hog-api-key
PORT=3001
NODE_ENV=development
SEED_PARTNER_EMAIL=you@example.com
SEED_PARTNER_PASSWORD=change-me
# Optional
# SEED_ANALYST_EMAIL=analyst@example.com
# SEED_ANALYST_PASSWORD=change-me-too
```

**Frontend (.env):**

```
VITE_API_URL=http://localhost:3001
```

---

## Tech Stack

### Backend

- **Runtime:** Bun
- **Framework:** Express.js
- **Database:** SQLite (bun:sqlite)
- **Auth:** JWT
- **Data access:** Raw SQL + lightweight services

### Frontend

- **Framework:** React 18 + Vite
- **Styling:** TailwindCSS + shadcn/ui
- **Icons:** Lucide React
- **State:** React Query + Zustand
- **Charts:** Recharts

### Integrations

- **GBrain:** Modified fork (multi-user)
- **GStack:** Agent skills
- **The Hog:** REST API

---

## Project Structure

```
vaultbrain/
├── backend/
│   ├── src/
│   │   ├── api/           # Express routes
│   │   ├── db/            # Database setup & seed
│   │   ├── middleware/    # Auth middleware
│   │   ├── services/      # Business logic
│   │   └── types/         # TypeScript types
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components
│   │   ├── lib/           # Utilities
│   │   └── App.tsx
│   └── package.json
├── gstack/                # Cloned repo
├── gbrain/                # Cloned repo
├── Skills/                # Usage guides
└── Designs/               # System design docs
```

---

## Troubleshooting

### Database Issues

```bash
# Delete the SQLite file if you need a clean slate
rm backend/dealflow.db

# Recreate schema and seed auth users
cd backend
bun run db:setup && bun run db:seed
```

### Port Already in Use

```bash
# Backend (3001)
lsof -ti:3001 | xargs kill -9

# Frontend (5173)
lsof -ti:5173 | xargs kill -9
```

### Dependencies Not Installing

```bash
# Backend
cd backend && rm -rf node_modules && bun install

# Frontend
cd frontend && rm -rf node_modules && npm install
```

---

## Hackathon Checklist

- [x] Clone gstack and gbrain
- [x] Create skills for gstack, gbrain, The Hog
- [x] Design system architecture
- [x] Implement shared GBrain backend
- [x] Implement The Hog integration
- [x] Create entity merge logic
- [x] Build permissions system
- [ ] Build React frontend
- [ ] Seed demo data
- [ ] Test end-to-end workflow
- [ ] Prepare demo

---

## License

MIT

---

## Team

Built for GStack x GBrain Hackathon  
May 16, 2026 | San Francisco, CA

**Target:** Grand Prize (YC interview + 1:1 with Garry Tan)
