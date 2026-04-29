"""ROR API client — handles matching against local Docker or public ROR API."""

from typing import Optional

import httpx


class RorClient:
    """Async client for the ROR API (local Docker or public)."""

    def __init__(self, base_url: str = "http://localhost:9292"):
        self.base_url = base_url.rstrip("/")
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=15)
        return self

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _build_candidate(
        self,
        org: dict,
        score: float,
        matching_type: str,
        chosen: bool,
        substring: str = "",
    ) -> dict:
        """Build a candidate dict from a v1 ROR org record, enriching from v2 if needed."""
        ror_id = org.get("id", "")
        candidate = {
            "ror_id": ror_id,
            "ror_name": org.get("name", ""),
            "score": score,
            "matching_type": matching_type,
            "chosen": 1 if chosen else 0,
            "substring": substring,
            "country": None,
            "country_code": None,
            "city": None,
            "aliases": org.get("aliases", []),
            "labels": [],
            "types": org.get("types", []),
        }

        # v1 location
        country_obj = org.get("country", {})
        if isinstance(country_obj, dict):
            candidate["country"] = country_obj.get("country_name")
            candidate["country_code"] = country_obj.get("country_code")

        addresses = org.get("addresses", [])
        if addresses:
            addr = addresses[0]
            candidate["city"] = addr.get("city")
            geo_city = addr.get("geonames_city", {})
            if geo_city and not candidate["city"]:
                candidate["city"] = geo_city.get("city")

        # v1 labels
        v1_labels = org.get("labels", [])
        if v1_labels:
            candidate["labels"] = [
                lbl.get("label", "") for lbl in v1_labels if lbl.get("label")
            ]

        # v2 fallback enrichment
        if not candidate["country"]:
            try:
                ror_id_short = ror_id.replace("https://ror.org/", "")
                v2_resp = await self.client.get(
                    f"{self.base_url}/v2/organizations/{ror_id_short}",
                )
                if v2_resp.status_code == 200:
                    v2_data = v2_resp.json()
                    locations = v2_data.get("locations", [])
                    if locations:
                        geo = locations[0].get("geonames_details", {})
                        candidate["country"] = geo.get("country_name")
                        candidate["country_code"] = geo.get("country_code")
                        candidate["city"] = geo.get("name")

                    names = v2_data.get("names", [])
                    v2_aliases = [
                        n.get("value", "")
                        for n in names
                        if "alias" in (n.get("types") or [])
                    ]
                    if v2_aliases:
                        candidate["aliases"] = v2_aliases
                    v2_labels = [
                        n.get("value", "")
                        for n in names
                        if "label" in (n.get("types") or [])
                    ]
                    if v2_labels:
                        candidate["labels"] = v2_labels
            except Exception:
                pass

        return candidate

    async def match(self, name: str, limit: int = 50) -> list[dict]:
        """Match an organization name against ROR.

        Combines two endpoints to work around ROR's affiliation cap of 10:
        - `affiliation`: smart matching with scores and matching_type, max 10
        - `query`: plain name search, paginated 20/page; supplements until `limit`
        Search-supplement results get score=0 and matching_type="search".
        """
        candidates: list[dict] = []
        seen_ror_ids: set[str] = set()

        # 1. Affiliation matching (scored, max 10 from ROR)
        try:
            resp = await self.client.get(
                f"{self.base_url}/organizations",
                params={"affiliation": name},
            )
            resp.raise_for_status()
            for item in resp.json().get("items", []):
                org = item.get("organization", {})
                ror_id = org.get("id", "")
                if not ror_id or ror_id in seen_ror_ids:
                    continue
                candidate = await self._build_candidate(
                    org,
                    score=item.get("score", 0),
                    matching_type=item.get("matching_type", ""),
                    chosen=item.get("chosen", False),
                    substring=item.get("substring", ""),
                )
                candidates.append(candidate)
                seen_ror_ids.add(ror_id)
        except Exception:
            pass

        # 2. Plain search supplement, paginated. Cap pages so we don't chase
        # tail results when the user's name is generic (e.g. "university").
        MAX_SEARCH_PAGES = 5
        page = 1
        while len(candidates) < limit and page <= MAX_SEARCH_PAGES:
            try:
                resp = await self.client.get(
                    f"{self.base_url}/organizations",
                    params={"query": name, "page": page},
                )
                resp.raise_for_status()
                items = resp.json().get("items", [])
                if not items:
                    break
                for org in items:
                    if len(candidates) >= limit:
                        break
                    ror_id = org.get("id", "")
                    if not ror_id or ror_id in seen_ror_ids:
                        continue
                    candidate = await self._build_candidate(
                        org,
                        score=0,
                        matching_type="search",
                        chosen=False,
                    )
                    candidates.append(candidate)
                    seen_ror_ids.add(ror_id)
                page += 1
            except Exception:
                break

        # Sort: chosen first, then score descending
        candidates.sort(key=lambda c: (-c["chosen"], -c["score"]))
        return candidates[:limit]

    async def is_available(self) -> bool:
        """Check if the ROR API is reachable."""
        try:
            resp = await self.client.get(
                f"{self.base_url}/organizations",
                params={"affiliation": "test"},
            )
            return resp.status_code == 200
        except Exception:
            return False
