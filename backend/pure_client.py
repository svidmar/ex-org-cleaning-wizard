"""Pure API client — handles all communication with the Pure REST API."""

import asyncio
import json
from typing import Optional

import httpx

LOCALE_PRIORITY = ["en_GB", "en_US", "da_DK"]

ROR_TYPE = {
    "uri": "/dk/atira/pure/ueoexternalorganisation/ueoexternalorganisationsources/ror",
    "term": {"en_GB": "ROR ID", "da_DK": "ROR ID"},
}


def extract_name(name_obj: dict) -> str:
    """Extract org name respecting locale priority."""
    if not name_obj:
        return ""
    for locale in LOCALE_PRIORITY:
        if locale in name_obj:
            return name_obj[locale]
    return next(iter(name_obj.values()), "")


def extract_country(org: dict) -> Optional[str]:
    """Extract country from a Pure external organization."""
    address = org.get("address") or {}
    country = address.get("country")
    if isinstance(country, dict):
        return extract_name(country.get("term", {})) or country.get("uri", "").split("/")[-1]
    if isinstance(country, str):
        return country
    country_obj = org.get("country")
    if isinstance(country_obj, dict):
        return extract_name(country_obj.get("term", {}))
    if isinstance(country_obj, str):
        return country_obj
    return None


def has_ror_id(org: dict) -> bool:
    """Check if org already has a ROR identifier."""
    for ident in org.get("identifiers", []):
        type_uri = (ident.get("type") or {}).get("uri", "")
        id_value = ident.get("id", "")
        if "ror" in type_uri.lower() or "ror.org" in id_value.lower():
            return True
    return False


def get_ror_id(org: dict) -> Optional[str]:
    """Get the ROR ID from a Pure org if it has one."""
    for ident in org.get("identifiers", []):
        type_uri = (ident.get("type") or {}).get("uri", "")
        id_value = ident.get("id", "")
        if "ror" in type_uri.lower() or "ror.org" in id_value.lower():
            return id_value
    return None


def workflow_step(org: dict) -> str:
    """Extract workflow step from org."""
    wf = org.get("workflow") or {}
    step = wf.get("step")
    if isinstance(step, str):
        return step
    if isinstance(step, dict):
        return step.get("uri", "").split("/")[-1] or extract_name(step.get("term", {}))
    return "unknown"


def format_org(org: dict) -> dict:
    """Format a Pure org into a clean dict for database storage."""
    return {
        "uuid": org.get("uuid", ""),
        "name": extract_name(org.get("name", {})),
        "name_locales": json.dumps(org.get("name", {})),
        "country": extract_country(org),
        "workflow_step": workflow_step(org),
        "has_ror": 1 if has_ror_id(org) else 0,
        "ror_id": get_ror_id(org),
        "identifiers": json.dumps(org.get("identifiers", [])),
        "version": org.get("version"),
        "pure_url": org.get("info", {}).get("portalUrl", ""),
    }


class PureClient:
    """Async client for the Pure REST API."""

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=30)
        return self

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()

    def _headers(self) -> dict:
        return {"api-key": self.api_key, "Accept": "application/json"}

    async def get(self, path: str, params: dict = None) -> dict:
        """GET request with retry and rate limit handling."""
        url = f"{self.base_url}{path}"
        for attempt in range(3):
            try:
                resp = await self._client.get(url, headers=self._headers(), params=params)
                if resp.status_code == 429:
                    await asyncio.sleep(2 ** attempt)
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError:
                if attempt == 2:
                    raise
                await asyncio.sleep(1)
        return {}

    async def put(self, path: str, json_body: dict) -> dict:
        """PUT request to Pure API."""
        url = f"{self.base_url}{path}"
        resp = await self._client.put(
            url,
            headers={**self._headers(), "Content-Type": "application/json"},
            json=json_body,
        )
        resp.raise_for_status()
        return resp.json()

    async def post(self, path: str, json_body: dict) -> dict:
        """POST request to Pure API."""
        url = f"{self.base_url}{path}"
        resp = await self._client.post(
            url,
            headers={**self._headers(), "Content-Type": "application/json"},
            json=json_body,
        )
        resp.raise_for_status()
        return resp.json()

    async def get_external_organizations(self, size: int = 100, offset: int = 0, search: str = None) -> dict:
        """Fetch a page of external organizations."""
        params = {"size": size, "offset": offset}
        if search:
            params["q"] = search
        return await self.get("/external-organizations", params)

    async def get_external_organization(self, uuid: str) -> dict:
        """Fetch a single external organization."""
        return await self.get(f"/external-organizations/{uuid}")

    async def link_ror_id(self, uuid: str, ror_id: str) -> dict:
        """Write a ROR ID to a Pure external organization."""
        org = await self.get(f"/external-organizations/{uuid}")

        if has_ror_id(org):
            return {"status": "already_linked", "ror_id": get_ror_id(org)}

        identifiers = org.get("identifiers", [])
        identifiers.append({
            "typeDiscriminator": "ClassifiedId",
            "id": ror_id,
            "type": ROR_TYPE,
        })

        result = await self.put(
            f"/external-organizations/{uuid}",
            {"version": org.get("version"), "identifiers": identifiers},
        )

        return {
            "status": "linked",
            "uuid": uuid,
            "ror_id": ror_id,
            "new_version": result.get("version"),
        }

    async def merge_organizations(self, target_uuid: str, source_uuids: list[str]) -> dict:
        """Merge source organizations into the target."""
        merge_items = [{"uuid": target_uuid, "systemName": "ExternalOrganization"}]
        for source_uuid in source_uuids:
            merge_items.append({"uuid": source_uuid, "systemName": "ExternalOrganization"})

        return await self.post("/external-organizations/merge", {"items": merge_items})
