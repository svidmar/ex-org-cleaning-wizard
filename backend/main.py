"""
Pure External Organization Cleaning Wizard — Backend
Routes only. Business logic lives in pure_client, ror_client, database, sync, matcher.
"""

import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import database as db
from pure_client import PureClient, format_org
from ror_client import RorClient
from sync import SyncJob
from matcher import MatchJob

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

logging.basicConfig(level=logging.INFO)

PURE_API_URL = os.getenv("PURE_API_URL", "").rstrip("/")
PURE_API_KEY = os.getenv("PURE_API_KEY", "")
ROR_API_BASE = os.getenv("ROR_API_BASE", "http://localhost:9292")

# Shared clients and jobs — initialized in lifespan
pure_client: PureClient = None  # type: ignore
ror_client: RorClient = None  # type: ignore
sync_job: SyncJob = None  # type: ignore
match_job: MatchJob = None  # type: ignore


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pure_client, ror_client, sync_job, match_job

    # Initialize database
    await db.get_db()

    # Initialize clients
    pure_client = PureClient(PURE_API_URL, PURE_API_KEY)
    await pure_client.__aenter__()

    ror_client = RorClient(ROR_API_BASE)
    await ror_client.__aenter__()

    sync_job = SyncJob(pure_client)
    match_job = MatchJob(ror_client)

    yield

    # Cleanup
    await sync_job.stop()
    await match_job.stop()
    await pure_client.__aexit__(None, None, None)
    await ror_client.__aexit__(None, None, None)
    await db.close_db()


app = FastAPI(title="Pure External Organization Cleaning Wizard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    ror_available = await ror_client.is_available()
    return {
        "status": "ok",
        "pureConfigured": bool(PURE_API_URL and PURE_API_KEY),
        "rorAvailable": ror_available,
        "rorBase": ROR_API_BASE,
    }


# ---------------------------------------------------------------------------
# Sync job
# ---------------------------------------------------------------------------

@app.post("/api/sync/start")
async def start_sync():
    if not PURE_API_URL or not PURE_API_KEY:
        raise HTTPException(500, "Pure API not configured")
    await sync_job.start()
    return await db.get_job_state("sync")


@app.get("/api/sync/status")
async def sync_status():
    return await db.get_job_state("sync")


@app.post("/api/sync/stop")
async def stop_sync():
    await sync_job.stop()
    return await db.get_job_state("sync")


# ---------------------------------------------------------------------------
# Match job
# ---------------------------------------------------------------------------

@app.post("/api/match/start")
async def start_match():
    await match_job.start()
    return await db.get_job_state("match")


@app.get("/api/match/status")
async def match_status():
    return await db.get_job_state("match")


@app.post("/api/match/stop")
async def stop_match():
    await match_job.stop()
    return await db.get_job_state("match")


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@app.get("/api/stats")
async def stats():
    return await db.get_stats()


@app.get("/api/countries")
async def countries():
    return await db.get_distinct_countries()


# ---------------------------------------------------------------------------
# Organizations (from SQLite)
# ---------------------------------------------------------------------------

@app.get("/api/organizations")
async def list_organizations(
    offset: int = Query(0, ge=0),
    size: int = Query(20, ge=1, le=100),
    workflow: Optional[str] = Query(None),
    has_ror: Optional[bool] = Query(None, alias="hasRor"),
    has_match: Optional[bool] = Query(None, alias="hasMatch"),
    min_score: Optional[float] = Query(None, alias="minScore"),
    max_score: Optional[float] = Query(None, alias="maxScore"),
    country: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: str = Query("name", alias="sortBy"),
    sort_dir: str = Query("asc", alias="sortDir"),
):
    items, total = await db.query_organizations(
        workflow=workflow,
        has_ror=has_ror,
        has_match=has_match,
        min_score=min_score,
        max_score=max_score,
        country=country,
        search=search,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=size,
        offset=offset,
    )
    # Parse JSON fields for response
    for item in items:
        item["nameLocales"] = json.loads(item.pop("name_locales", "{}"))
        item["identifiers"] = json.loads(item.pop("identifiers", "[]"))
        item["workflowStep"] = item.pop("workflow_step", "unknown")
        item["hasRor"] = bool(item.pop("has_ror", 0))
        item["rorId"] = item.pop("ror_id", None)
        item["bestMatchScore"] = item.pop("best_match_score", None)
        item["bestMatchRorId"] = item.pop("best_match_ror_id", None)
        item["bestMatchChosen"] = bool(item.pop("best_match_chosen", 0))
        item["pureUrl"] = item.pop("pure_url", "")
        item["syncedAt"] = item.pop("synced_at", "")

    return {"items": items, "total": total, "offset": offset, "size": size}


@app.get("/api/organizations/{uuid}")
async def get_organization(uuid: str):
    org = await db.get_organization(uuid)
    if not org:
        raise HTTPException(404, "Organization not found in local database")

    # Parse JSON fields
    org["nameLocales"] = json.loads(org.pop("name_locales", "{}"))
    org["identifiers"] = json.loads(org.pop("identifiers", "[]"))
    org["workflowStep"] = org.pop("workflow_step", "unknown")
    org["hasRor"] = bool(org.pop("has_ror", 0))
    org["rorId"] = org.pop("ror_id", None)
    org["bestMatchScore"] = org.pop("best_match_score", None)
    org["bestMatchRorId"] = org.pop("best_match_ror_id", None)
    org["bestMatchChosen"] = bool(org.pop("best_match_chosen", 0))
    org["pureUrl"] = org.pop("pure_url", "")
    org["syncedAt"] = org.pop("synced_at", "")

    # Parse ROR match fields
    for m in org.get("ror_matches", []):
        m["rorId"] = m.pop("ror_id", "")
        m["rorName"] = m.pop("ror_name", "")
        m["matchingType"] = m.pop("matching_type", "")
        m["countryCode"] = m.pop("country_code", None)
        m["aliases"] = json.loads(m.pop("aliases", "[]"))
        m["labels"] = json.loads(m.pop("labels", "[]"))
        m["types"] = json.loads(m.pop("types", "[]"))
        m["orgUuid"] = m.pop("org_uuid", "")
        m["fetchedAt"] = m.pop("fetched_at", "")

    org["rorMatches"] = org.pop("ror_matches", [])
    return org


@app.get("/api/organizations/{uuid}/dependencies")
async def get_dependencies(uuid: str):
    """Look up dependents via Pure's /external-organizations/{uuid}/dependents endpoint."""
    try:
        data = await pure_client.get(f"/external-organizations/{uuid}/dependents")
        items = data.get("items", [])

        # Group by systemName
        by_type: dict[str, int] = {}
        for item in items:
            sys_name = item.get("systemName", "Unknown")
            by_type[sys_name] = by_type.get(sys_name, 0) + 1

        return {
            "total": len(items),
            "byType": by_type,
            "items": items,
        }
    except Exception:
        return {"total": 0, "byType": {}, "items": []}


@app.post("/api/organizations/{uuid}/rematch")
async def rematch_organization(uuid: str):
    """Re-run ROR matching for a single organization."""
    org = await db.get_organization(uuid)
    if not org:
        raise HTTPException(404, "Organization not found")

    candidates = await ror_client.match(org["name"])
    await db.upsert_ror_matches(uuid, candidates)

    return {"uuid": uuid, "candidateCount": len(candidates)}


# ---------------------------------------------------------------------------
# Link ROR
# ---------------------------------------------------------------------------

class LinkRorRequest(BaseModel):
    uuid: str
    rorId: str
    rorName: Optional[str] = None


@app.post("/api/organizations/link-ror")
async def link_ror(req: LinkRorRequest):
    result = await pure_client.link_ror_id(req.uuid, req.rorId)

    if result["status"] == "linked":
        # Update SQLite
        await db.mark_org_linked(req.uuid, req.rorId, result.get("new_version"))

        # Log action
        await db.log_action(
            action="linked",
            org_uuid=req.uuid,
            ror_id=req.rorId,
            ror_name=req.rorName,
        )

    return {
        "status": result["status"],
        "uuid": req.uuid,
        "rorId": req.rorId,
    }


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

@app.get("/api/merge-candidates")
async def merge_candidates(
    min_score: float = Query(0.8, alias="minScore", ge=0, le=1),
):
    groups = await db.find_merge_candidates(min_score=min_score)
    # Format for frontend
    for g in groups:
        for key in ("approved", "for_approval"):
            for org in g[key]:
                org["nameLocales"] = json.loads(org.pop("name_locales", "{}"))
                org["identifiers"] = json.loads(org.pop("identifiers", "[]"))
                org["workflowStep"] = org.pop("workflow_step", "unknown")
                org["hasRor"] = bool(org.pop("has_ror", 0))
                org["rorId"] = org.pop("ror_id", None)
                org["bestMatchScore"] = org.pop("best_match_score", None)
                org["bestMatchRorId"] = org.pop("best_match_ror_id", None)
                org["pureUrl"] = org.pop("pure_url", "")
        g["forApproval"] = g.pop("for_approval")
        g["rorId"] = g.pop("ror_id")
        g["rorName"] = g.pop("ror_name", None)
    return {"groups": groups}


class MergeRequest(BaseModel):
    targetUuid: str
    sourceUuids: list[str]
    rorId: Optional[str] = None  # Link this ROR ID to target if not already linked


@app.post("/api/organizations/merge")
async def merge_organizations(req: MergeRequest):
    # Verify target is approved in local DB
    target = await db.get_organization(req.targetUuid)
    if not target:
        raise HTTPException(404, "Target organization not found")

    step = target["workflow_step"].lower().replace(" ", "")
    if "approved" not in step or "forapproval" in step:
        raise HTTPException(400, f"Target must be approved. Current: {target['workflow_step']}")

    # Link ROR ID to target if provided and not already linked
    ror_linked = False
    if req.rorId and not target.get("has_ror"):
        try:
            link_result = await pure_client.link_ror_id(req.targetUuid, req.rorId)
            if link_result["status"] == "linked":
                await db.mark_org_linked(req.targetUuid, req.rorId, link_result.get("new_version"))
                ror_linked = True
                await db.log_action(
                    action="linked",
                    org_uuid=req.targetUuid,
                    org_name=target["name"],
                    ror_id=req.rorId,
                )
        except Exception as e:
            raise HTTPException(400, f"Failed to link ROR ID to target: {e}")

    # Merge each source individually so one failure doesn't block the rest
    from pure_client import PureApiError
    merged_uuids = []
    failed = []

    for source_uuid in req.sourceUuids:
        # Get source name before attempting merge
        src = await db.get_organization(source_uuid)
        src_name = src["name"] if src else "Unknown"

        try:
            await pure_client.merge_organizations(req.targetUuid, [source_uuid])
            merged_uuids.append(source_uuid)

            # Remove from SQLite and log
            await db.remove_organizations([source_uuid])
            await db.log_action(
                action="merged",
                org_uuid=source_uuid,
                org_name=src_name,
                ror_id=req.rorId or target.get("ror_id"),
                details={
                    "target_uuid": req.targetUuid,
                    "target_name": target["name"],
                },
            )
        except PureApiError as e:
            failed.append({"uuid": source_uuid, "name": src_name, "error": str(e)})
        except Exception as e:
            failed.append({"uuid": source_uuid, "name": src_name, "error": str(e)})

    return {
        "status": "partial" if failed else "merged",
        "targetUuid": req.targetUuid,
        "mergedCount": len(merged_uuids),
        "failedCount": len(failed),
        "failed": failed,
        "rorLinked": ror_linked,
    }


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

@app.get("/api/history")
async def history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    items, total = await db.get_history(limit, offset)
    # Camelcase keys
    for item in items:
        item["orgUuid"] = item.pop("org_uuid", "")
        item["orgName"] = item.pop("org_name", "")
        item["rorId"] = item.pop("ror_id", None)
        item["rorName"] = item.pop("ror_name", None)
        item["matchingType"] = item.pop("matching_type", None)
        item["createdAt"] = item.pop("created_at", "")
    return {"items": items, "total": total}


@app.get("/api/history/download")
async def history_download():
    """Download full action history as CSV."""
    from fastapi.responses import StreamingResponse
    import csv
    import io

    items, _ = await db.get_history(limit=100000, offset=0)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Action", "Org UUID", "Org Name", "ROR ID", "ROR Name",
        "Score", "Matching Type", "Target UUID", "Target Name", "Timestamp",
    ])
    for item in items:
        details = json.loads(item.get("details", "{}"))
        writer.writerow([
            item.get("action", ""),
            item.get("org_uuid", ""),
            item.get("org_name", ""),
            item.get("ror_id", ""),
            item.get("ror_name", ""),
            item.get("score", ""),
            item.get("matching_type", ""),
            details.get("target_uuid", ""),
            details.get("target_name", ""),
            item.get("created_at", ""),
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cleaning-wizard-history.csv"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
