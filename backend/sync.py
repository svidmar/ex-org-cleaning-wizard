"""Sync job — fetches all external organizations from Pure into SQLite."""

import asyncio
import json
import logging

from pure_client import PureClient, format_org
import database as db

logger = logging.getLogger(__name__)

PAGE_SIZE = 100


class SyncJob:
    """Background job that syncs Pure external organizations to SQLite."""

    def __init__(self, pure_client: PureClient):
        self.pure = pure_client
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self):
        """Start or resume the sync job."""
        if self.running:
            return

        self._stop_event.clear()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        """Stop the sync job gracefully."""
        self._stop_event.set()
        if self._task and not self._task.done():
            await self._task

    async def _run(self):
        try:
            # Get checkpoint
            state = await db.get_job_state("sync")
            checkpoint = json.loads(state.get("checkpoint") or "{}")
            start_offset = checkpoint.get("offset", 0)

            # Get total count first
            first_page = await self.pure.get_external_organizations(size=1, offset=0)
            total = first_page.get("count", 0)

            await db.update_job_state(
                "sync",
                status="running",
                progress=start_offset,
                total=total,
                started_at=db._now(),
                error_message=None,
            )

            offset = start_offset
            while offset < total:
                if self._stop_event.is_set():
                    await db.update_job_state(
                        "sync",
                        status="paused",
                        progress=offset,
                        checkpoint=json.dumps({"offset": offset}),
                    )
                    logger.info(f"Sync paused at offset {offset}/{total}")
                    return

                try:
                    data = await self.pure.get_external_organizations(
                        size=PAGE_SIZE, offset=offset
                    )
                    items = data.get("items", [])

                    if not items:
                        break

                    # Format and batch upsert
                    formatted = [format_org(org) for org in items]
                    await db.upsert_organization_batch(formatted)

                    offset += len(items)
                    await db.update_job_state(
                        "sync",
                        progress=offset,
                        checkpoint=json.dumps({"offset": offset}),
                    )

                    logger.info(f"Sync progress: {offset}/{total}")

                except Exception as e:
                    logger.error(f"Error syncing page at offset {offset}: {e}")
                    # Continue to next page on non-fatal errors
                    offset += PAGE_SIZE
                    await asyncio.sleep(1)

            await db.update_job_state(
                "sync",
                status="completed",
                progress=total,
                checkpoint=json.dumps({"offset": 0}),
            )
            logger.info(f"Sync completed: {total} organizations")

        except Exception as e:
            logger.error(f"Sync job failed: {e}")
            await db.update_job_state(
                "sync",
                status="error",
                error_message=str(e),
            )
