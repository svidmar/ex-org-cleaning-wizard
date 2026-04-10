# Pure External Organization Cleaning Wizard

A tool for managing, matching, and merging external organizations in [Pure](https://www.elsevier.com/products/pure) using the [ROR](https://ror.org) (Research Organization Registry).

<img width="1260" height="544" alt="Skærmbillede 2026-03-24 kl  13 42 05" src="https://github.com/user-attachments/assets/74848148-4578-4cc5-b7f2-775752097fbd" />


Designed for institutions with tens of thousands of external organizations where duplicates accumulate over time. The tool identifies duplicates by matching organizations against ROR, then lets you merge them with human-in-the-loop confirmation.

> **Use at your own risk.** Merging external organizations in Pure is **irreversible**. There is no undo. While the tool maintains an audit trail and requires human confirmation before every merge, reversing a wrong merge means manually recreating the organization and reassigning all its associations — which is painful even with the CSV export. Start with high-confidence matches, review carefully, and when in doubt, skip.

## Safety checks

The local SQLite database is treated as a **hint** for what might be a duplicate, not as the source of truth. Every merge action — both validation and execution — re-fetches live data from Pure and applies four checks against each merge candidate. These checks run twice:

1. **When you click Merge** in the merge group card (`POST /api/organizations/validate-merge`) — the confirm modal only shows pre-validated candidates
2. **When you click Confirm Merge** in the modal (`POST /api/organizations/merge`) — the same checks run again before any payload is sent to Pure

For each candidate the backend verifies:

- **UUID identity** — fetches the candidate from Pure and verifies the returned UUID matches what was requested. Pure redirects fetches of merged UUIDs to the surviving org, so a mismatch means the candidate was already consumed by a previous merge. Skipped.
- **previousUuids** — checks the target's `previousUuids` array. If the candidate is already there, it's already been merged into this target. Skipped.
- **Approved status** — refuses to merge an approved org into another approved org. The candidate must be `for approval` (or similar) in Pure's live data.
- **ROR ID mismatch** — if the candidate has a ROR ID linked in Pure that differs from the target's, they're treated as different organizations. Skipped.

The `link-ror` endpoint also verifies UUID identity before writing — preventing a ROR ID from being written to the wrong org if the UUID was already merged.

Sources that fail any check are skipped (not merged) and reported in the response with the reason. Valid sources still merge normally.

The Dashboard also surfaces a warning if any organizations have **multiple ROR IDs**, which is usually a sign of an incorrect merge or data entry error.

## How it works

1. **Sync** all external organizations from your Pure instance into a local SQLite database
2. **Batch match** every unmatched org against a local ROR API (Docker) to find ROR candidates
3. **Identify duplicates** — orgs that match to the same ROR ID + country are grouped
4. **Merge** — review each group, deselect false positives, and merge with one click. The ROR ID is linked to the target automatically

Country is a first-class signal: "University of Technology" in the US and Australia are not duplicates.

## Architecture

```
React UI (Vite + Tailwind)  →  FastAPI backend  →  SQLite (local cache)
                                                 →  Pure API (read/write)
                                                 →  ROR Docker API (batch matching)
```

No external database. SQLite stores the local cache. ROR runs locally via Docker (required for batch matching ~80k orgs without hitting public API rate limits).

## Setup

### 1. Local ROR API

The [ROR API](https://github.com/ror-community/ror-api) must run locally via Docker. A `docker-compose.yml` is provided, but if you already have the ROR Docker containers from a previous setup, just start them:

```bash
docker compose up -d
```

The ROR API should be available at http://localhost:9292. First startup requires indexing — see [ROR API docs](https://github.com/ror-community/ror-api) for details.

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
PURE_API_URL=https://your-institution.elsevierpure.com/ws/api
PURE_API_KEY=your-api-key
ROR_API_BASE=http://localhost:9292
```

### 3. Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

Runs on http://localhost:8001.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on http://localhost:5173.

## Workflow

### Initial setup (once)

Open the **Dashboard** tab:

1. Click **Start** on "Sync from Pure" — fetches all external organizations into SQLite. Progress is shown in real-time. Supports pause/resume.
2. Once synced, click **Start** on "Batch ROR Match" — matches every org without a ROR ID against the local ROR Docker instance (5 concurrent). Stores top candidates per org.

### Merging duplicates (main workflow)

The **Merge** tab is the primary work surface:

- Shows duplicate groups: orgs that match to the same ROR ID and country
- Each group shows the approved org (merge target) and for-approval orgs (duplicates)
- **Deselect** any false positives with checkboxes before merging
- **Search** for specific groups by name, ROR ID, or country
- **Min score filter** to control confidence level (90%+, 80%+, etc.)
- If multiple approved orgs exist, **select which one** to use as the merge target via radio buttons
- Click **Merge** — links the ROR ID to the target (if not already linked) and merges the selected for-approval orgs into it via Pure's merge API
- Dependencies are shown in the confirmation modal so you can see what's linked before merging

### Reviewing individual orgs

The **Queue** tab offers preset queues for manual review:

- **For approval + high match** — best candidates for quick linking (>= 90%)
- **For approval + medium match** — need manual review (60-89%)
- **For approval, no match** — ROR found nothing
- **Approved, no ROR** — validated orgs still missing a ROR ID
- Or search by name

Click an org to open the **Review** tab with side-by-side Pure org details vs ROR candidates. You can link a ROR ID or re-match against ROR.

### When to re-sync

Re-run sync when new external organizations have been added to Pure (e.g. from new publications). The sync is incremental — existing orgs are updated, new ones added. Then re-run batch match to process the new orgs.

### History

The **History** tab shows a full audit trail of all link and merge actions.

## Project structure

```
backend/
  main.py          — FastAPI routes
  database.py      — SQLite schema and queries
  pure_client.py   — Pure API client
  ror_client.py    — ROR API client (supports v1 local Docker + v2 public)
  sync.py          — Background sync job (Pure → SQLite)
  matcher.py       — Background ROR batch matching job
frontend/
  src/
    App.tsx         — Tab navigation shell
    api.ts          — API client functions
    types.ts        — TypeScript type definitions
    components/     — Shared UI components (badges, modals, toasts, etc.)
    views/          — Dashboard, Queue, Review, Merge, History
docker-compose.yml  — Local ROR API (Elasticsearch + MySQL + ROR)
.env.example        — Configuration template
```

## License

MIT — see [LICENSE](LICENSE).
