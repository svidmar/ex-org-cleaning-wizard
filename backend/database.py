"""SQLite database layer — schema, queries, and all data access."""

import json
import os
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS organizations (
    uuid            TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    name_locales    TEXT NOT NULL DEFAULT '{}',
    country         TEXT,
    workflow_step   TEXT NOT NULL DEFAULT 'unknown',
    has_ror         INTEGER NOT NULL DEFAULT 0,
    ror_id          TEXT,
    identifiers     TEXT NOT NULL DEFAULT '[]',
    version         TEXT,
    pure_url        TEXT,
    synced_at       TEXT NOT NULL,
    best_match_score    REAL,
    best_match_ror_id   TEXT,
    best_match_chosen   INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_org_workflow ON organizations(workflow_step);
CREATE INDEX IF NOT EXISTS idx_org_has_ror ON organizations(has_ror);
CREATE INDEX IF NOT EXISTS idx_org_country ON organizations(country);
CREATE INDEX IF NOT EXISTS idx_org_ror_id ON organizations(ror_id);
CREATE INDEX IF NOT EXISTS idx_org_best_score ON organizations(best_match_score);

CREATE TABLE IF NOT EXISTS ror_matches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    org_uuid        TEXT NOT NULL REFERENCES organizations(uuid) ON DELETE CASCADE,
    ror_id          TEXT NOT NULL,
    ror_name        TEXT NOT NULL,
    score           REAL NOT NULL,
    matching_type   TEXT,
    chosen          INTEGER NOT NULL DEFAULT 0,
    country         TEXT,
    country_code    TEXT,
    city            TEXT,
    aliases         TEXT DEFAULT '[]',
    labels          TEXT DEFAULT '[]',
    types           TEXT DEFAULT '[]',
    fetched_at      TEXT NOT NULL,
    UNIQUE(org_uuid, ror_id)
);

CREATE INDEX IF NOT EXISTS idx_match_org ON ror_matches(org_uuid);
CREATE INDEX IF NOT EXISTS idx_match_ror ON ror_matches(ror_id);
CREATE INDEX IF NOT EXISTS idx_match_score ON ror_matches(score);

CREATE TABLE IF NOT EXISTS action_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    action          TEXT NOT NULL,
    org_uuid        TEXT NOT NULL,
    org_name        TEXT,
    ror_id          TEXT,
    ror_name        TEXT,
    score           REAL,
    matching_type   TEXT,
    details         TEXT DEFAULT '{}',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_log_action ON action_log(action);
CREATE INDEX IF NOT EXISTS idx_log_created ON action_log(created_at);

CREATE TABLE IF NOT EXISTS job_state (
    job_name        TEXT PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'idle',
    progress        INTEGER DEFAULT 0,
    total           INTEGER DEFAULT 0,
    started_at      TEXT,
    updated_at      TEXT,
    error_message   TEXT,
    checkpoint      TEXT
);
"""

_db: Optional[aiosqlite.Connection] = None


async def get_db() -> aiosqlite.Connection:
    """Get the database connection, initializing if needed."""
    global _db
    if _db is None:
        _db = await aiosqlite.connect(DB_PATH)
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA foreign_keys=ON")
        await _db.executescript(SCHEMA)
        # Initialize job_state rows
        await _db.execute(
            "INSERT OR IGNORE INTO job_state (job_name, status) VALUES ('sync', 'idle')"
        )
        await _db.execute(
            "INSERT OR IGNORE INTO job_state (job_name, status) VALUES ('match', 'idle')"
        )
        await _db.commit()
    return _db


async def close_db():
    """Close the database connection."""
    global _db
    if _db:
        await _db.close()
        _db = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------

async def upsert_organization(org: dict):
    """Insert or update an organization from Pure sync."""
    db = await get_db()
    await db.execute(
        """INSERT INTO organizations
           (uuid, name, name_locales, country, workflow_step, has_ror, ror_id,
            identifiers, version, pure_url, synced_at)
           VALUES (:uuid, :name, :name_locales, :country, :workflow_step, :has_ror,
                   :ror_id, :identifiers, :version, :pure_url, :synced_at)
           ON CONFLICT(uuid) DO UPDATE SET
                name=excluded.name, name_locales=excluded.name_locales,
                country=excluded.country, workflow_step=excluded.workflow_step,
                has_ror=excluded.has_ror, ror_id=excluded.ror_id,
                identifiers=excluded.identifiers, version=excluded.version,
                pure_url=excluded.pure_url, synced_at=excluded.synced_at
        """,
        {**org, "synced_at": _now()},
    )


async def upsert_organization_batch(orgs: list[dict]):
    """Bulk upsert organizations. Commits once at the end."""
    db = await get_db()
    now = _now()
    for org in orgs:
        await db.execute(
            """INSERT INTO organizations
               (uuid, name, name_locales, country, workflow_step, has_ror, ror_id,
                identifiers, version, pure_url, synced_at)
               VALUES (:uuid, :name, :name_locales, :country, :workflow_step, :has_ror,
                       :ror_id, :identifiers, :version, :pure_url, :synced_at)
               ON CONFLICT(uuid) DO UPDATE SET
                    name=excluded.name, name_locales=excluded.name_locales,
                    country=excluded.country, workflow_step=excluded.workflow_step,
                    has_ror=excluded.has_ror, ror_id=excluded.ror_id,
                    identifiers=excluded.identifiers, version=excluded.version,
                    pure_url=excluded.pure_url, synced_at=excluded.synced_at
            """,
            {**org, "synced_at": now},
        )
    await db.commit()


async def query_organizations(
    workflow: Optional[str] = None,
    has_ror: Optional[bool] = None,
    has_match: Optional[bool] = None,
    min_score: Optional[float] = None,
    max_score: Optional[float] = None,
    country: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "name",
    sort_dir: str = "asc",
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Query organizations with filters. Returns (rows, total_count)."""
    db = await get_db()

    where_clauses = []
    params = {}

    if workflow:
        where_clauses.append("workflow_step = :workflow")
        params["workflow"] = workflow

    if has_ror is not None:
        where_clauses.append("has_ror = :has_ror")
        params["has_ror"] = 1 if has_ror else 0

    if has_match is not None:
        if has_match:
            where_clauses.append("best_match_score IS NOT NULL")
        else:
            where_clauses.append("best_match_score IS NULL")

    if min_score is not None:
        where_clauses.append("best_match_score >= :min_score")
        params["min_score"] = min_score

    if max_score is not None:
        where_clauses.append("best_match_score < :max_score")
        params["max_score"] = max_score

    if country:
        where_clauses.append("country = :country")
        params["country"] = country

    if search:
        where_clauses.append("name LIKE :search")
        params["search"] = f"%{search}%"

    where = " AND ".join(where_clauses) if where_clauses else "1=1"

    # Validate sort
    allowed_sorts = {"name", "country", "workflow_step", "best_match_score", "synced_at", "has_ror"}
    if sort_by not in allowed_sorts:
        sort_by = "name"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "asc"

    # Get total count
    count_row = await db.execute_fetchall(
        f"SELECT COUNT(*) as cnt FROM organizations WHERE {where}", params
    )
    total = count_row[0][0] if count_row else 0

    # Get rows
    rows = await db.execute_fetchall(
        f"""SELECT * FROM organizations
            WHERE {where}
            ORDER BY {sort_by} {sort_dir}
            LIMIT :limit OFFSET :offset""",
        {**params, "limit": limit, "offset": offset},
    )

    return [dict(r) for r in rows], total


async def get_organization(uuid: str) -> Optional[dict]:
    """Get a single organization with its ROR matches."""
    db = await get_db()
    row = await db.execute_fetchall(
        "SELECT * FROM organizations WHERE uuid = ?", (uuid,)
    )
    if not row:
        return None
    org = dict(row[0])

    # Get ROR matches
    matches = await db.execute_fetchall(
        "SELECT * FROM ror_matches WHERE org_uuid = ? ORDER BY chosen DESC, score DESC",
        (uuid,),
    )
    org["ror_matches"] = [dict(m) for m in matches]
    return org


async def get_distinct_countries() -> list[str]:
    """Get all distinct country values."""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT DISTINCT country FROM organizations WHERE country IS NOT NULL ORDER BY country"
    )
    return [r[0] for r in rows]


# ---------------------------------------------------------------------------
# ROR Matches
# ---------------------------------------------------------------------------

async def upsert_ror_matches(org_uuid: str, candidates: list[dict]):
    """Replace all ROR match candidates for an org."""
    db = await get_db()
    now = _now()

    # Delete existing matches for this org
    await db.execute("DELETE FROM ror_matches WHERE org_uuid = ?", (org_uuid,))

    for c in candidates:
        await db.execute(
            """INSERT INTO ror_matches
               (org_uuid, ror_id, ror_name, score, matching_type, chosen,
                country, country_code, city, aliases, labels, types, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                org_uuid, c["ror_id"], c["ror_name"], c["score"],
                c.get("matching_type"), c.get("chosen", 0),
                c.get("country"), c.get("country_code"), c.get("city"),
                json.dumps(c.get("aliases", [])),
                json.dumps(c.get("labels", [])),
                json.dumps(c.get("types", [])),
                now,
            ),
        )

    # Update denormalized best match on organizations
    if candidates:
        best = candidates[0]  # Already sorted by chosen desc, score desc
        await db.execute(
            """UPDATE organizations SET
               best_match_score = ?, best_match_ror_id = ?, best_match_chosen = ?
               WHERE uuid = ?""",
            (best["score"], best["ror_id"], best.get("chosen", 0), org_uuid),
        )
    else:
        await db.execute(
            """UPDATE organizations SET
               best_match_score = NULL, best_match_ror_id = NULL, best_match_chosen = 0
               WHERE uuid = ?""",
            (org_uuid,),
        )

    await db.commit()


# ---------------------------------------------------------------------------
# Merge candidates
# ---------------------------------------------------------------------------

async def find_merge_candidates(min_score: float = 0.8) -> list[dict]:
    """Find groups of orgs that are likely duplicates based on ROR.

    Groups by the "effective ROR ID" — either the already-linked ror_id,
    or the best_match_ror_id from batch matching (if score >= min_score).
    Only groups with at least one approved org (merge target) and at least
    one for-approval org (merge source) are returned.
    """
    db = await get_db()

    # Use COALESCE: prefer already-linked ror_id, fall back to best_match_ror_id
    # Filter: must have an effective ROR ID, must have country, and if using
    # best_match, score must be above threshold
    groups = await db.execute_fetchall(
        """SELECT effective_ror, country, COUNT(*) as cnt FROM (
               SELECT
                   COALESCE(ror_id, best_match_ror_id) as effective_ror,
                   country,
                   uuid
               FROM organizations
               WHERE COALESCE(ror_id, best_match_ror_id) IS NOT NULL
                 AND country IS NOT NULL
                 AND (ror_id IS NOT NULL OR best_match_score >= :min_score)
           )
           GROUP BY effective_ror, country
           HAVING COUNT(*) > 1
           ORDER BY cnt DESC""",
        {"min_score": min_score},
    )

    result = []
    for g in groups:
        effective_ror, country, cnt = g[0], g[1], g[2]

        # Fetch all orgs in this group
        orgs = await db.execute_fetchall(
            """SELECT * FROM organizations
               WHERE COALESCE(ror_id, best_match_ror_id) = ?
                 AND country = ?
                 AND (ror_id IS NOT NULL OR best_match_score >= ?)""",
            (effective_ror, country, min_score),
        )
        org_list = [dict(o) for o in orgs]
        approved = [o for o in org_list if _is_approved(o["workflow_step"])]
        for_approval = [o for o in org_list if _is_for_approval(o["workflow_step"])]

        if approved and for_approval:
            # Get the ROR name from the best match of the first org
            ror_name = None
            for o in org_list:
                matches = await db.execute_fetchall(
                    "SELECT ror_name FROM ror_matches WHERE org_uuid = ? AND ror_id = ? LIMIT 1",
                    (o["uuid"], effective_ror),
                )
                if matches:
                    ror_name = matches[0][0]
                    break

            result.append({
                "ror_id": effective_ror,
                "ror_name": ror_name,
                "country": country,
                "approved": approved,
                "for_approval": for_approval,
                "total": len(org_list),
            })

    return result


def _is_approved(step: str) -> bool:
    s = step.lower().replace(" ", "")
    return "approved" in s and "forapproval" not in s


def _is_for_approval(step: str) -> bool:
    return "forapproval" in step.lower().replace(" ", "")


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

async def get_stats() -> dict:
    """Get aggregate statistics."""
    db = await get_db()

    rows = await db.execute_fetchall("SELECT COUNT(*) FROM organizations")
    total = rows[0][0]

    rows = await db.execute_fetchall(
        "SELECT workflow_step, COUNT(*) FROM organizations GROUP BY workflow_step"
    )
    by_workflow = {r[0]: r[1] for r in rows}

    rows = await db.execute_fetchall(
        "SELECT has_ror, COUNT(*) FROM organizations GROUP BY has_ror"
    )
    by_ror = {r[0]: r[1] for r in rows}

    rows = await db.execute_fetchall(
        "SELECT COUNT(*) FROM organizations WHERE best_match_score IS NOT NULL"
    )
    matched = rows[0][0]

    rows = await db.execute_fetchall(
        "SELECT COUNT(*) FROM organizations WHERE best_match_score >= 0.9"
    )
    high_confidence = rows[0][0]

    rows = await db.execute_fetchall(
        "SELECT COUNT(*) FROM organizations WHERE best_match_score >= 0.6 AND best_match_score < 0.9"
    )
    medium_confidence = rows[0][0]

    rows = await db.execute_fetchall(
        "SELECT COUNT(*) FROM organizations WHERE best_match_score > 0 AND best_match_score < 0.6"
    )
    low_confidence = rows[0][0]

    # Count for-approval without ROR (priority queue)
    rows = await db.execute_fetchall(
        """SELECT COUNT(*) FROM organizations
           WHERE has_ror = 0 AND workflow_step IN ('forApproval', 'For approval')"""
    )
    for_approval_no_ror = rows[0][0]

    # Action counts from log
    rows = await db.execute_fetchall(
        "SELECT COUNT(*) FROM action_log WHERE action = 'merged'"
    )
    total_merged = rows[0][0]

    rows = await db.execute_fetchall(
        "SELECT COUNT(*) FROM action_log WHERE action = 'linked'"
    )
    total_linked = rows[0][0]

    return {
        "total": total,
        "approved": sum(v for k, v in by_workflow.items() if _is_approved(k)),
        "forApproval": sum(v for k, v in by_workflow.items() if _is_for_approval(k)),
        "withRor": by_ror.get(1, 0),
        "withoutRor": by_ror.get(0, 0),
        "matched": matched,
        "unmatched": total - matched,
        "highConfidence": high_confidence,
        "mediumConfidence": medium_confidence,
        "lowConfidence": low_confidence,
        "forApprovalNoRor": for_approval_no_ror,
        "totalMerged": total_merged,
        "totalLinked": total_linked,
        "lastSyncedAt": await _get_last_synced(),
    }


async def _get_last_synced() -> str | None:
    """Get the most recent synced_at timestamp."""
    d = await get_db()
    rows = await d.execute_fetchall(
        "SELECT MAX(synced_at) FROM organizations"
    )
    return rows[0][0] if rows and rows[0][0] else None


# ---------------------------------------------------------------------------
# Action log
# ---------------------------------------------------------------------------

async def log_action(
    action: str,
    org_uuid: str,
    org_name: str = None,
    ror_id: str = None,
    ror_name: str = None,
    score: float = None,
    matching_type: str = None,
    details: dict = None,
):
    """Log an action to the audit trail."""
    db = await get_db()
    await db.execute(
        """INSERT INTO action_log
           (action, org_uuid, org_name, ror_id, ror_name, score, matching_type, details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (action, org_uuid, org_name, ror_id, ror_name, score, matching_type,
         json.dumps(details or {})),
    )
    await db.commit()


async def get_history(limit: int = 50, offset: int = 0) -> tuple[list[dict], int]:
    """Get action history, newest first."""
    db = await get_db()
    rows = await db.execute_fetchall("SELECT COUNT(*) FROM action_log")
    total = rows[0][0]

    rows = await db.execute_fetchall(
        "SELECT * FROM action_log ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, offset),
    )
    return [dict(r) for r in rows], total


# ---------------------------------------------------------------------------
# Job state
# ---------------------------------------------------------------------------

async def get_job_state(job_name: str) -> dict:
    """Get the state of a background job."""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM job_state WHERE job_name = ?", (job_name,)
    )
    if rows:
        return dict(rows[0])
    return {"job_name": job_name, "status": "idle", "progress": 0, "total": 0}


async def update_job_state(job_name: str, **kwargs):
    """Update job state fields."""
    db = await get_db()
    sets = []
    params = {}
    for k, v in kwargs.items():
        sets.append(f"{k} = :{k}")
        params[k] = v
    params["updated_at"] = _now()
    sets.append("updated_at = :updated_at")
    params["job_name"] = job_name

    await db.execute(
        f"UPDATE job_state SET {', '.join(sets)} WHERE job_name = :job_name",
        params,
    )
    await db.commit()


async def mark_org_linked(uuid: str, ror_id: str, new_version: str = None):
    """Update an org in SQLite after linking a ROR ID in Pure."""
    db = await get_db()
    params = {"ror_id": ror_id, "has_ror": 1, "uuid": uuid}
    sql = "UPDATE organizations SET ror_id = :ror_id, has_ror = :has_ror"
    if new_version:
        sql += ", version = :version"
        params["version"] = new_version
    sql += " WHERE uuid = :uuid"
    await db.execute(sql, params)
    await db.commit()


async def remove_organizations(uuids: list[str]):
    """Remove merged organizations from SQLite."""
    db = await get_db()
    placeholders = ",".join("?" * len(uuids))
    await db.execute(f"DELETE FROM organizations WHERE uuid IN ({placeholders})", uuids)
    await db.commit()
