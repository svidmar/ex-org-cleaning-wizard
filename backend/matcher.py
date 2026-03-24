"""Matcher job — batch-matches organizations against ROR API."""

import asyncio
import json
import logging

from ror_client import RorClient
import database as db

logger = logging.getLogger(__name__)

CONCURRENCY = 5


class MatchJob:
    """Background job that matches unmatched orgs against ROR."""

    def __init__(self, ror_client: RorClient):
        self.ror = ror_client
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self):
        """Start or resume the match job."""
        if self.running:
            return

        self._stop_event.clear()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        """Stop the match job gracefully."""
        self._stop_event.set()
        if self._task and not self._task.done():
            await self._task

    async def _run(self):
        try:
            # Get unmatched orgs (no ROR ID and no match results yet)
            d = await db.get_db()
            rows = await d.execute_fetchall(
                """SELECT uuid, name FROM organizations
                   WHERE has_ror = 0 AND best_match_score IS NULL
                   ORDER BY
                       CASE workflow_step
                           WHEN 'forApproval' THEN 0
                           WHEN 'For approval' THEN 0
                           ELSE 1
                       END,
                       name"""
            )
            orgs = [(r[0], r[1]) for r in rows]
            total = len(orgs)

            if total == 0:
                await db.update_job_state("match", status="completed", progress=0, total=0)
                return

            # Get checkpoint
            state = await db.get_job_state("match")
            checkpoint = json.loads(state.get("checkpoint") or "{}")
            last_uuid = checkpoint.get("last_uuid")

            # Skip to checkpoint
            start_idx = 0
            if last_uuid:
                for i, (uuid, _) in enumerate(orgs):
                    if uuid == last_uuid:
                        start_idx = i + 1
                        break

            await db.update_job_state(
                "match",
                status="running",
                progress=start_idx,
                total=total,
                started_at=db._now(),
                error_message=None,
            )

            semaphore = asyncio.Semaphore(CONCURRENCY)
            processed = start_idx

            async def match_one(uuid: str, name: str):
                nonlocal processed
                async with semaphore:
                    if self._stop_event.is_set():
                        return

                    try:
                        candidates = await self.ror.match(name)
                        await db.upsert_ror_matches(uuid, candidates)
                    except Exception as e:
                        logger.error(f"Error matching {uuid} ({name}): {e}")

                    processed += 1
                    if processed % 50 == 0:
                        await db.update_job_state(
                            "match",
                            progress=processed,
                            checkpoint=json.dumps({"last_uuid": uuid}),
                        )
                        logger.info(f"Match progress: {processed}/{total}")

            # Process in chunks to allow stop checks between batches
            chunk_size = CONCURRENCY * 10
            for i in range(start_idx, total, chunk_size):
                if self._stop_event.is_set():
                    await db.update_job_state(
                        "match",
                        status="paused",
                        progress=processed,
                        checkpoint=json.dumps({"last_uuid": orgs[max(0, processed - 1)][0]}),
                    )
                    logger.info(f"Match paused at {processed}/{total}")
                    return

                chunk = orgs[i : i + chunk_size]
                tasks = [match_one(uuid, name) for uuid, name in chunk]
                await asyncio.gather(*tasks)

            await db.update_job_state(
                "match",
                status="completed",
                progress=total,
                total=total,
                checkpoint=json.dumps({"last_uuid": ""}),
            )
            logger.info(f"Match completed: {total} organizations processed")

        except Exception as e:
            logger.error(f"Match job failed: {e}")
            await db.update_job_state(
                "match",
                status="error",
                error_message=str(e),
            )
